/**
 * Tiny runtime i18n shared by the popup (classic script + module) and the
 * content script. No build step, no chrome.i18n: the popup switch stores the
 * chosen locale in chrome.storage.local and every context re-renders from it.
 *
 * Order is intentional and must match the language <select> in popup.html:
 * English, 简体中文, 繁體中文, 日本語, 한국어, Deutsch, Français, Español,
 * Português (Brasil), Русский.
 */
(function (global) {
  const supported = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es', 'pt-BR', 'ru'];

  const messages = {
    en: {
      'popup.downloads': 'Download monitoring',
      'popup.downloadsDesc': 'Hand download links to Nifty.',
      'popup.videos': 'Video monitoring',
      'popup.videosDesc': 'Show video badges on the page',
      'popup.language': 'Language',
      'popup.website': 'Website',
      'popup.status.connected': 'Nifty connected',
      'popup.status.offline': 'Open the Nifty desktop app',
      'popup.status.offlineAria': 'Nifty is not connected. Open the Nifty desktop app.',
      'overlay.badgeTitle': 'Videos detected by Nifty',
      'overlay.videoCount': 'Videos: {n}',
      'overlay.download': 'Download',
      'overlay.sending': 'Sending…',
      'overlay.sent': 'Sent',
      'overlay.failed': 'Failed',
      'overlay.offline': 'Open Nifty',
      'overlay.videoFile': 'Video file',
    },
    'zh-CN': {
      'popup.downloads': '下载监测',
      'popup.downloadsDesc': '下载链接交给 Nifty。',
      'popup.videos': '视频监测',
      'popup.videosDesc': '开启页面视频左上角标',
      'popup.language': '语言',
      'popup.website': '官网',
      'popup.status.connected': 'Nifty 已连接',
      'popup.status.offline': '请打开 Nifty 桌面端',
      'popup.status.offlineAria': 'Nifty 未连接，请打开 Nifty 桌面端。',
      'overlay.badgeTitle': 'Nifty 监测到的视频',
      'overlay.videoCount': '视频: {n}',
      'overlay.download': '下载',
      'overlay.sending': '发送中…',
      'overlay.sent': '已发送',
      'overlay.failed': '发送失败',
      'overlay.offline': 'Nifty 未运行',
      'overlay.videoFile': '视频文件',
    },
    'zh-TW': {
      'popup.downloads': '下載監測',
      'popup.downloadsDesc': '下載連結交給 Nifty。',
      'popup.videos': '影片監測',
      'popup.videosDesc': '開啟頁面影片左上角標',
      'popup.language': '語言',
      'popup.website': '官網',
      'popup.status.connected': 'Nifty 已連線',
      'popup.status.offline': '請開啟 Nifty 桌面端',
      'popup.status.offlineAria': 'Nifty 未連線，請開啟 Nifty 桌面端。',
      'overlay.badgeTitle': 'Nifty 偵測到的影片',
      'overlay.videoCount': '影片: {n}',
      'overlay.download': '下載',
      'overlay.sending': '傳送中…',
      'overlay.sent': '已傳送',
      'overlay.failed': '傳送失敗',
      'overlay.offline': 'Nifty 未執行',
      'overlay.videoFile': '影片檔案',
    },
    ja: {
      'popup.downloads': 'ダウンロード監視',
      'popup.downloadsDesc': 'ダウンロードリンクを Nifty に渡します。',
      'popup.videos': '動画監視',
      'popup.videosDesc': 'ページの動画左上にバッジを表示',
      'popup.language': '言語',
      'popup.website': '公式サイト',
      'popup.status.connected': 'Nifty に接続済み',
      'popup.status.offline': 'Nifty を起動してください',
      'popup.status.offlineAria': 'Nifty に接続されていません。Nifty を起動してください。',
      'overlay.badgeTitle': 'Nifty が検出した動画',
      'overlay.videoCount': '動画: {n}',
      'overlay.download': 'ダウンロード',
      'overlay.sending': '送信中…',
      'overlay.sent': '送信済み',
      'overlay.failed': '失敗',
      'overlay.offline': 'Nifty を起動',
      'overlay.videoFile': '動画ファイル',
    },
    ko: {
      'popup.downloads': '다운로드 모니터링',
      'popup.downloadsDesc': '다운로드 링크를 Nifty로 전달합니다.',
      'popup.videos': '동영상 모니터링',
      'popup.videosDesc': '페이지 동영상 왼쪽 위에 배지 표시',
      'popup.language': '언어',
      'popup.website': '공식 사이트',
      'popup.status.connected': 'Nifty 연결됨',
      'popup.status.offline': 'Nifty 앱을 열어 주세요',
      'popup.status.offlineAria': 'Nifty에 연결되지 않았습니다. Nifty 데스크톱 앱을 열어 주세요.',
      'overlay.badgeTitle': 'Nifty가 감지한 동영상',
      'overlay.videoCount': '동영상: {n}',
      'overlay.download': '다운로드',
      'overlay.sending': '전송 중…',
      'overlay.sent': '전송됨',
      'overlay.failed': '실패',
      'overlay.offline': 'Nifty 열기',
      'overlay.videoFile': '동영상 파일',
    },
    de: {
      'popup.downloads': 'Download-Überwachung',
      'popup.downloadsDesc': 'Download-Links an Nifty übergeben.',
      'popup.videos': 'Video-Überwachung',
      'popup.videosDesc': 'Videobadges auf der Seite anzeigen',
      'popup.language': 'Sprache',
      'popup.website': 'Website',
      'popup.status.connected': 'Nifty verbunden',
      'popup.status.offline': 'Nifty-Desktop-App öffnen',
      'popup.status.offlineAria': 'Nifty ist nicht verbunden. Öffnen Sie die Nifty-Desktop-App.',
      'overlay.badgeTitle': 'Von Nifty erkannte Videos',
      'overlay.videoCount': 'Videos: {n}',
      'overlay.download': 'Herunterladen',
      'overlay.sending': 'Wird gesendet…',
      'overlay.sent': 'Gesendet',
      'overlay.failed': 'Fehlgeschlagen',
      'overlay.offline': 'Nifty öffnen',
      'overlay.videoFile': 'Videodatei',
    },
    fr: {
      'popup.downloads': 'Surveillance des téléchargements',
      'popup.downloadsDesc': 'Transmettre les liens de téléchargement à Nifty.',
      'popup.videos': 'Surveillance vidéo',
      'popup.videosDesc': 'Afficher les badges vidéo sur la page',
      'popup.language': 'Langue',
      'popup.website': 'Site',
      'popup.status.connected': 'Nifty connecté',
      'popup.status.offline': "Ouvrez l'application Nifty",
      'popup.status.offlineAria': "Nifty n'est pas connecté. Ouvrez l'application Nifty.",
      'overlay.badgeTitle': 'Vidéos détectées par Nifty',
      'overlay.videoCount': 'Vidéos : {n}',
      'overlay.download': 'Télécharger',
      'overlay.sending': 'Envoi…',
      'overlay.sent': 'Envoyé',
      'overlay.failed': 'Échec',
      'overlay.offline': 'Ouvrir Nifty',
      'overlay.videoFile': 'Fichier vidéo',
    },
    es: {
      'popup.downloads': 'Supervisión de descargas',
      'popup.downloadsDesc': 'Pasar los enlaces de descarga a Nifty.',
      'popup.videos': 'Supervisión de vídeo',
      'popup.videosDesc': 'Mostrar distintivos de vídeo en la página',
      'popup.language': 'Idioma',
      'popup.website': 'Sitio web',
      'popup.status.connected': 'Nifty conectado',
      'popup.status.offline': 'Abre la aplicación Nifty',
      'popup.status.offlineAria': 'Nifty no está conectado. Abre la aplicación Nifty.',
      'overlay.badgeTitle': 'Vídeos detectados por Nifty',
      'overlay.videoCount': 'Vídeos: {n}',
      'overlay.download': 'Descargar',
      'overlay.sending': 'Enviando…',
      'overlay.sent': 'Enviado',
      'overlay.failed': 'Error',
      'overlay.offline': 'Abrir Nifty',
      'overlay.videoFile': 'Archivo de vídeo',
    },
    'pt-BR': {
      'popup.downloads': 'Monitoramento de downloads',
      'popup.downloadsDesc': 'Entregar links de download ao Nifty.',
      'popup.videos': 'Monitoramento de vídeo',
      'popup.videosDesc': 'Mostrar selos de vídeo na página',
      'popup.language': 'Idioma',
      'popup.website': 'Site',
      'popup.status.connected': 'Nifty conectado',
      'popup.status.offline': 'Abra o aplicativo Nifty',
      'popup.status.offlineAria': 'O Nifty não está conectado. Abra o aplicativo Nifty.',
      'overlay.badgeTitle': 'Vídeos detectados pelo Nifty',
      'overlay.videoCount': 'Vídeos: {n}',
      'overlay.download': 'Baixar',
      'overlay.sending': 'Enviando…',
      'overlay.sent': 'Enviado',
      'overlay.failed': 'Falhou',
      'overlay.offline': 'Abrir o Nifty',
      'overlay.videoFile': 'Arquivo de vídeo',
    },
    ru: {
      'popup.downloads': 'Мониторинг загрузок',
      'popup.downloadsDesc': 'Передавать ссылки на загрузку в Nifty.',
      'popup.videos': 'Мониторинг видео',
      'popup.videosDesc': 'Показывать значки видео на странице',
      'popup.language': 'Язык',
      'popup.website': 'Сайт',
      'popup.status.connected': 'Nifty подключён',
      'popup.status.offline': 'Откройте приложение Nifty',
      'popup.status.offlineAria': 'Nifty не подключён. Откройте приложение Nifty.',
      'overlay.badgeTitle': 'Видео, обнаруженные Nifty',
      'overlay.videoCount': 'Видео: {n}',
      'overlay.download': 'Скачать',
      'overlay.sending': 'Отправка…',
      'overlay.sent': 'Отправлено',
      'overlay.failed': 'Ошибка',
      'overlay.offline': 'Открыть Nifty',
      'overlay.videoFile': 'Видеофайл',
    },
  };

  /**
   * Normalize both our exact selector values and browser UI tags such as
   * `en-US`, `de-DE`, `zh-Hans-CN`, `zh-Hant-TW`, `pt-PT`.
   */
  function normalize(value) {
    if (typeof value !== 'string' || !value.trim()) return 'en';
    const tag = value.trim().replaceAll('_', '-');
    const lower = tag.toLowerCase();

    if (lower === 'zh' || lower === 'zh-cn' || lower === 'zh-sg' || lower.startsWith('zh-hans')) return 'zh-CN';
    if (lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-mo' || lower.startsWith('zh-hant')) return 'zh-TW';
    if (lower === 'pt' || lower.startsWith('pt-')) return 'pt-BR';

    const exact = supported.find((code) => code.toLowerCase() === lower);
    if (exact) return exact;

    const base = lower.split('-')[0];
    const baseLanguage = {
      en: 'en', ja: 'ja', ko: 'ko', de: 'de', fr: 'fr', es: 'es', ru: 'ru',
    }[base];
    return baseLanguage || 'en';
  }

  /** Chrome UI language first; navigator.language is the content-script fallback. */
  function browserLanguage() {
    let raw = '';
    try {
      raw = global.chrome?.i18n?.getUILanguage?.() || '';
    } catch {
      raw = '';
    }
    if (!raw) {
      try {
        raw = global.navigator?.language || '';
      } catch {
        raw = '';
      }
    }
    return normalize(raw);
  }

  function t(lang, key, vars) {
    const table = messages[normalize(lang)];
    let text = table[key] ?? messages.en[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.replaceAll(`{${name}}`, String(value));
      }
    }
    return text;
  }

  function apply(root, lang) {
    const resolved = normalize(lang);
    for (const element of root.querySelectorAll('[data-i18n]')) {
      element.textContent = t(resolved, element.dataset.i18n);
    }
    for (const element of root.querySelectorAll('[data-i18n-title]')) {
      element.title = t(resolved, element.dataset.i18nTitle);
    }
    for (const element of root.querySelectorAll('[data-i18n-aria-label]')) {
      element.setAttribute('aria-label', t(resolved, element.dataset.i18nAriaLabel));
    }
    root.documentElement.lang = resolved;
  }

  global.NiftyI18n = { messages, supported, normalize, browserLanguage, t, apply };
})(globalThis);
