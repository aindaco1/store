(function () {
  'use strict';

  var FIRST_FRAME_ATTR = 'data-first-frame-poster';
  var FIRST_FRAME_READY_ATTR = 'data-first-frame-poster-ready';
  var FIRST_FRAME_PENDING_ATTR = 'data-first-frame-poster-pending';
  var FIRST_FRAME_OBSERVED_ATTR = 'data-first-frame-poster-observed';
  var FIRST_FRAME_INDEX_ATTR = 'data-first-frame-poster-index';
  var MAX_POSTER_WIDTH = 1280;
  var posterObserver = null;

  function getVideoSource(video) {
    var source = video.currentSrc || '';
    if (!source) {
      var sourceEl = video.querySelector('source');
      source = sourceEl ? sourceEl.getAttribute('src') || '' : '';
    }
    return source;
  }

  function cacheBustedSameOriginUrl(src, index) {
    try {
      var url = new URL(src, window.location.href);
      if (url.origin !== window.location.origin) return '';
      url.searchParams.set('store_first_frame_poster', String(Date.now()) + '-' + String(index));
      return url.href;
    } catch (_error) {
      return '';
    }
  }

  function setFirstFramePoster(video, index) {
    if (!(video instanceof HTMLVideoElement)) return;
    if (video.poster || video.hasAttribute(FIRST_FRAME_READY_ATTR) || video.hasAttribute(FIRST_FRAME_PENDING_ATTR)) return;

    var src = getVideoSource(video);
    var posterSrc = cacheBustedSameOriginUrl(src, index);
    if (!posterSrc) return;

    video.setAttribute(FIRST_FRAME_PENDING_ATTR, 'true');

    var preview = document.createElement('video');
    var timeoutId = 0;

    function cleanup(markReady) {
      window.clearTimeout(timeoutId);
      preview.removeAttribute('src');
      try {
        preview.load();
      } catch (_error) {
        // Best effort cleanup only.
      }
      video.removeAttribute(FIRST_FRAME_PENDING_ATTR);
      if (markReady) video.setAttribute(FIRST_FRAME_READY_ATTR, 'true');
    }

    function captureFrame() {
      if (!preview.videoWidth || !preview.videoHeight || video.poster) return;

      var scale = Math.min(1, MAX_POSTER_WIDTH / preview.videoWidth);
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(preview.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(preview.videoHeight * scale));

      var context = canvas.getContext('2d');
      if (!context) {
        cleanup(false);
        return;
      }

      try {
        context.drawImage(preview, 0, 0, canvas.width, canvas.height);
        video.poster = canvas.toDataURL('image/jpeg', 0.86);
        cleanup(true);
      } catch (_error) {
        cleanup(false);
      }
    }

    preview.muted = true;
    preview.playsInline = true;
    preview.preload = 'auto';
    preview.addEventListener('loadeddata', captureFrame, { once: true });
    preview.addEventListener('canplay', captureFrame, { once: true });
    preview.addEventListener('error', function () {
      cleanup(false);
    }, { once: true });

    timeoutId = window.setTimeout(function () {
      cleanup(false);
    }, 5000);

    preview.src = posterSrc;
    preview.load();
  }

  function getPosterObserver() {
    if (posterObserver || !('IntersectionObserver' in window)) return posterObserver;

    posterObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting && entry.intersectionRatio <= 0) return;

        var video = entry.target;
        posterObserver.unobserve(video);
        video.removeAttribute(FIRST_FRAME_OBSERVED_ATTR);
        var index = Number(video.getAttribute(FIRST_FRAME_INDEX_ATTR) || '0');
        video.removeAttribute(FIRST_FRAME_INDEX_ATTR);
        setFirstFramePoster(video, index);
      });
    }, {
      rootMargin: '600px 0px'
    });

    return posterObserver;
  }

  function scheduleFirstFramePoster(video, index) {
    if (!(video instanceof HTMLVideoElement)) return;
    if (
      video.poster ||
      video.hasAttribute(FIRST_FRAME_READY_ATTR) ||
      video.hasAttribute(FIRST_FRAME_PENDING_ATTR) ||
      video.hasAttribute(FIRST_FRAME_OBSERVED_ATTR)
    ) {
      return;
    }

    var observer = getPosterObserver();
    if (observer) {
      video.setAttribute(FIRST_FRAME_OBSERVED_ATTR, 'true');
      video.setAttribute(FIRST_FRAME_INDEX_ATTR, String(index));
      observer.observe(video);
      return;
    }

    window.setTimeout(function () {
      setFirstFramePoster(video, index);
    }, 1500);
  }

  function init(root) {
    var scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    var videos = [];
    if (scope instanceof HTMLVideoElement && scope.hasAttribute(FIRST_FRAME_ATTR)) {
      videos.push(scope);
    }
    scope.querySelectorAll('video[' + FIRST_FRAME_ATTR + ']').forEach(function (video) {
      videos.push(video);
    });
    videos.forEach(scheduleFirstFramePoster);
  }

  var videoPosters = {
    init: init
  };
  window.StoreVideoPosters = videoPosters;
  window.StoreVideoPosters = videoPosters;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      init(document);
    }, { once: true });
  } else {
    init(document);
  }
})();
