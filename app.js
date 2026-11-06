'use strict';

(function () {
  var ROUNDS = 10;
  var MIN = 50000;
  var MAX = 2000000;
  var STEP = 5000;
  var FMT = new Intl.NumberFormat('ru-RU');

  // Ошибка = |твоя цена − реальная| / реальная
  var BANDS = [
    { t: 0.05, pts: 100, label: 'Ювелирно!' },
    { t: 0.10, pts: 85,  label: 'Очень близко' },
    { t: 0.20, pts: 65,  label: 'Близко' },
    { t: 0.35, pts: 40,  label: 'Неважно' },
    { t: 0.60, pts: 20,  label: 'Мимо' },
    { t: Infinity, pts: 10, label: 'Совсем мимо' }
  ];

  var VERDICTS = {
    ok: {
      emoji: '😎',
      title: 'Адекватный квартирант',
      text: 'Твои цены в среднем совпали с реальными. Ты тонко чувствуешь рынок северных квартир — самое время идти на просмотры.'
    },
    greedy: {
      emoji: '🎓',
      title: 'Жадный студент',
      text: 'Твои ставки как правило ниже реальных цен. Квартиры в Коми оказались дороже, чем ты думал, — не продешеви на торгах.'
    },
    spend: {
      emoji: '🤑',
      title: 'Транжира',
      text: 'Твои ставки как правило выше реальных цен. На севере Коми можно жить заметно дешевле, чем ты готов платить.'
    }
  };

  var state = { deck: [], round: 0, results: [], gIndex: 0 };

  function $(id) { return document.getElementById(id); }
  function rub(n) { return FMT.format(n) + ' ₽'; }
  function signed(diff) {
    if (diff === 0) return '0 ₽';
    return (diff > 0 ? '+' : '−') + FMT.format(Math.abs(diff)) + ' ₽';
  }
  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }
  function ptsWord(n) { return plural(n, 'балл', 'балла', 'баллов'); }

  function showScreen(name) {
    ['start', 'round', 'result', 'final'].forEach(function (s) {
      $('screen-' + s).classList.toggle('hidden', s !== name);
    });
    window.scrollTo(0, 0);
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function setProgress() {
    var n = Math.min(state.round + 1, ROUNDS);
    document.querySelectorAll('.round-label').forEach(function (el) {
      el.textContent = 'Раунд ' + n + ' из ' + ROUNDS;
    });
    document.querySelectorAll('.progress-fill').forEach(function (el) {
      el.style.width = (n / ROUNDS * 100) + '%';
    });
  }

  /* ---------- галерея ---------- */
  var track = $('g-track');

  function buildGallery(lot) {
    var dots = $('g-dots');
    track.innerHTML = '';
    dots.innerHTML = '';
    lot.photos.forEach(function (src, i) {
      var slide = document.createElement('div');
      slide.className = 'g-slide';
      var bg = document.createElement('div');
      bg.className = 'g-bg';
      bg.style.backgroundImage = 'url("' + src + '")';
      var img = document.createElement('img');
      img.src = src;
      img.alt = 'Фото ' + (i + 1);
      img.loading = i === 0 ? 'eager' : 'lazy';
      img.decoding = 'async';
      slide.appendChild(bg);
      slide.appendChild(img);
      track.appendChild(slide);

      var d = document.createElement('i');
      if (i === 0) d.className = 'on';
      dots.appendChild(d);
    });
    var many = lot.photos.length > 1;
    $('g-prev').classList.toggle('hidden', !many);
    $('g-next').classList.toggle('hidden', !many);
    $('g-count').classList.toggle('hidden', !many);
    state.gIndex = 0;
    track.scrollLeft = 0;
    updateGalleryNav();
  }

  function updateGalleryNav() {
    var lot = state.deck[state.round];
    if (!lot) return;
    var n = lot.photos.length;
    var i = state.gIndex;
    $('g-count').textContent = n > 1 ? (i + 1) + ' / ' + n : '';
    var dots = $('g-dots').children;
    for (var k = 0; k < dots.length; k++) dots[k].className = k === i ? 'on' : '';
  }

  track.addEventListener('scroll', function () {
    if (!state.deck.length) return;
    var w = track.clientWidth || 1;
    var i = Math.round(track.scrollLeft / w);
    if (i !== state.gIndex) {
      state.gIndex = i;
      updateGalleryNav();
    }
  }, { passive: true });

  $('g-prev').addEventListener('click', function () {
    track.scrollBy({ left: -track.clientWidth, behavior: 'smooth' });
  });
  $('g-next').addEventListener('click', function () {
    track.scrollBy({ left: track.clientWidth, behavior: 'smooth' });
  });

  /* ---------- раунд ---------- */
  function updateGuess() {
    $('guess-value').textContent = rub(+$('guess-slider').value);
  }
  $('guess-slider').addEventListener('input', updateGuess);

  function renderRound() {
    var lot = state.deck[state.round];
    setProgress();
    buildGallery(lot);
    $('lot-title').textContent = lot.desc;
    $('lot-street').textContent = lot.street + ' · Инта, Республика Коми';
    $('guess-slider').value = String(Math.round((MIN + MAX) / 2 / STEP) * STEP);
    updateGuess();
    $('btn-rate').disabled = false;
    showScreen('round');
    if (state.round + 1 < state.deck.length) {
      var pre = new Image();
      pre.src = state.deck[state.round + 1].photos[0];
    }
  }

  /* ---------- оценка лота ---------- */
  $('btn-rate').addEventListener('click', function () {
    var lot = state.deck[state.round];
    var guess = +$('guess-slider').value;
    var diff = guess - lot.price;
    var err = Math.abs(diff) / lot.price;
    var band = BANDS.find(function (b) { return err <= b.t; });
    state.results.push({ lot: lot, guess: guess, diff: diff, err: err, pts: band.pts, label: band.label });
    renderResult();
  });

  function renderResult() {
    var r = state.results[state.results.length - 1];
    setProgress();
    $('res-photo').src = r.lot.photos[0];
    $('res-band').textContent = r.label;
    $('res-title').textContent = r.lot.desc;
    $('res-street').textContent = r.lot.street + ' · Инта, Республика Коми';
    $('res-real').textContent = rub(r.lot.price);
    $('res-guess').textContent = rub(r.guess);
    var d = $('res-diff');
    var pct = Math.round(r.err * 100);
    d.textContent = signed(r.diff) + ' (' + (r.diff > 0 ? '+' : r.diff < 0 ? '−' : '') + pct + '%)';
    d.className = 'v ' + (r.diff > 0 ? 'over' : r.diff < 0 ? 'under' : '');
    $('res-pts').textContent = '+' + r.pts + ' ' + ptsWord(r.pts) + ' · «' + r.label + '»';
    $('res-link').href = r.lot.url;
    $('btn-next').textContent = state.round + 1 === ROUNDS ? 'Показать итоги' : 'Следующая квартира';
    showScreen('result');
  }

  $('btn-next').addEventListener('click', function () {
    if (state.round + 1 === ROUNDS) {
      renderFinal();
    } else {
      state.round++;
      renderRound();
    }
  });

  /* ---------- финал ---------- */
  function renderFinal() {
    var rs = state.results;
    var total = rs.reduce(function (s, r) { return s + r.pts; }, 0);
    var bias = rs.reduce(function (s, r) { return s + r.diff / r.lot.price; }, 0) / rs.length;
    var avgErr = rs.reduce(function (s, r) { return s + r.err; }, 0) / rs.length;
    var net = rs.reduce(function (s, r) { return s + r.diff; }, 0);
    var hits = rs.filter(function (r) { return r.err <= 0.05; }).length;

    $('fin-total').textContent = total;

    var v = bias < -0.10 ? VERDICTS.greedy : bias > 0.10 ? VERDICTS.spend : VERDICTS.ok;
    $('fin-verdict').innerHTML =
      '<div class="vt">' + v.emoji + ' ' + v.title + '</div>' +
      '<div class="vd">' + v.text + '</div>';

    $('st-err').textContent = Math.round(avgErr * 100) + '%';
    $('st-hits').textContent = hits + ' из ' + rs.length;
    $('st-net').textContent = signed(net);
    $('st-net-k').textContent = net > 0
      ? 'суммарно твои цены выше реальных'
      : net < 0
        ? 'суммарно твои цены ниже реальных'
        : 'суммарная разница с реальными ценами';

    $('fin-list').innerHTML = rs.map(function (r, i) {
      return '<div class="rl">' +
        '<div class="rl-main"><b>' + (i + 1) + '. ' + r.lot.rooms + '-к, ' + r.lot.area + ' м² · ' + r.lot.street + '</b>' +
        '<span>ты: ' + rub(r.guess) + ' · факт: ' + rub(r.lot.price) + ' (' + signed(r.diff) + ')</span></div>' +
        '<div class="rl-side">+' + r.pts + '</div></div>';
    }).join('');

    showScreen('final');
  }

  /* ---------- старт ---------- */
  function startGame() {
    state.deck = shuffle(window.LISTINGS.slice()).slice(0, ROUNDS);
    state.round = 0;
    state.results = [];
    renderRound();
  }
  $('btn-start').addEventListener('click', startGame);
  $('btn-again').addEventListener('click', startGame);
})();
