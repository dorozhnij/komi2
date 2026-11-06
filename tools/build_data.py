#!/usr/bin/env python3
"""Сборка данных игры «Медиакоми».

Читает выгрузку объявлений Avito (CSV), скачивает фотографии, сжимает их
для мобильных экранов и генерирует data.js с лотами игры.

Запуск из папки mediakomi:  python3 tools/build_data.py
"""
import csv
import json
import os
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(os.path.dirname(ROOT), 'data komi - Лист1.csv')
IMG_DIR = os.path.join(ROOT, 'assets', 'img')

MAX_DIM = 800        # максимальная сторона фото, px
QUALITY = 72         # качество JPEG
MIN_KEEP_PHOTOS = 2  # лот без галереи не берём
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36')


def digits(s):
    return int(re.sub(r'\D', '', s or ''))


def parse_rows():
    with open(CSV_PATH, encoding='utf-8') as f:
        rows = list(csv.reader(f))
    lots = []
    for r in rows[1:]:
        r = r + [''] * (10 - len(r))
        url = r[0].strip()
        photos = [p.strip() for p in r[1:6] if p.strip()]
        m = re.search(r'_([0-9]{6,})(?:\?|$)', url)
        if not m or not photos:
            continue  # нет ссылки или фото — лот не годится для игры
        desc = r[8].strip()
        d = re.match(r'(\d)-к\.\s*квартира,\s*([\d,]+)\s*м²,\s*(\d+)/(\d+)\s*эт\.', desc)
        lots.append({
            'id': m.group(1),
            'url': url.split('?')[0],
            'price': digits(r[6]),
            'ppm': digits(r[7]),
            'desc': desc,
            'street': r[9].strip(),
            'rooms': int(d.group(1)) if d else None,
            'area': float(d.group(2).replace(',', '.')) if d else None,
            'floor': d.group(3) + '/' + d.group(4) if d else None,
            'photo_urls': photos,
        })
    return lots


def download(task):
    url, dest = task
    if os.path.exists(dest) and os.path.getsize(dest) > 2000:
        return True
    for _ in range(3):
        try:
            req = Request(url, headers={'User-Agent': UA})
            data = urlopen(req, timeout=30).read()
            if len(data) > 2000:
                with open(dest, 'wb') as f:
                    f.write(data)
                return True
        except Exception:
            pass
    return False


def sips_info(path, keys):
    args = []
    for k in keys:
        args += ['-g', k]
    out = subprocess.run(['sips'] + args + [path], capture_output=True, text=True)
    vals = {}
    for k in keys:
        m = re.search(k + r': (\S+)', out.stdout)
        vals[k] = m.group(1) if m else None
    return vals


def optimize(path):
    """Приводит фото к JPEG нужного размера. True — файл годен."""
    info = sips_info(path, ['format', 'pixelWidth', 'pixelHeight'])
    fmt = info['format']
    try:
        w, h = int(info['pixelWidth']), int(info['pixelHeight'])
    except (TypeError, ValueError):
        return False
    if fmt == 'jpeg' and max(w, h) <= MAX_DIM:
        return True
    cmd = ['sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', str(QUALITY)]
    if max(w, h) > MAX_DIM:
        cmd += ['-Z', str(MAX_DIM)]
    r = subprocess.run(cmd + [path], capture_output=True, text=True)
    return r.returncode == 0 and os.path.getsize(path) > 2000


def main():
    os.makedirs(IMG_DIR, exist_ok=True)
    lots = parse_rows()
    print('Лотов с фото в выгрузке: %d' % len(lots))

    tasks = []
    for lot in lots:
        for i, u in enumerate(lot['photo_urls']):
            tasks.append((u, os.path.join(IMG_DIR, '%s_%d.jpg' % (lot['id'], i))))
    print('Скачивание %d фото…' % len(tasks))
    with ThreadPoolExecutor(max_workers=8) as ex:
        ok = list(ex.map(download, tasks))
    failed = sum(1 for o in ok if not o)
    if failed:
        print('Не скачалось: %d' % failed)

    out = []
    for lot in lots:
        photos = []
        for i in range(len(lot['photo_urls'])):
            p = os.path.join(IMG_DIR, '%s_%d.jpg' % (lot['id'], i))
            if os.path.exists(p) and os.path.getsize(p) > 2000 and optimize(p):
                photos.append('assets/img/%s_%d.jpg' % (lot['id'], i))
        if len(photos) >= MIN_KEEP_PHOTOS:
            lot['photos'] = photos
            del lot['photo_urls']
            out.append(lot)
        else:
            print('Пропущен лот %s: живых фото %d' % (lot['id'], len(photos)))
    out.sort(key=lambda l: int(l['id']))

    with open(os.path.join(ROOT, 'data.js'), 'w', encoding='utf-8') as f:
        f.write('window.LISTINGS = ' + json.dumps(out, ensure_ascii=False, indent=1) + ';\n')
    with open(os.path.join(ROOT, 'tools', 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

    total = sum(os.path.getsize(os.path.join(ROOT, p)) for l in out for p in l['photos'])
    print('Готово: %d лотов, %d фото, %.1f МБ' % (
        len(out), sum(len(l['photos']) for l in out), total / 1048576))


if __name__ == '__main__':
    main()
