/**
 * Cô Sign Embed SDK
 *
 * Lightweight JS SDK for partners to embed fill sessions in their websites.
 *
 * Usage:
 *   <div id="cosign-container"></div>
 *   <script src="https://your-cosign-domain.com/embed-sdk.js"></script>
 *   <script>
 *     CosignEmbed.init({
 *       containerId: 'cosign-container',
 *       token: 'SESSION_TOKEN',
 *       language: 'vi',
 *       onComplete: function(data) { console.log('Done:', data); },
 *       onError: function(err) { console.error('Error:', err); },
 *       onReady: function() { console.log('Loaded'); },
 *     });
 *   </script>
 */

(function (root) {
  'use strict';

  // The Cô Sign address is the origin this script was loaded from: the
  // script element running now (document.currentScript), else the last
  // <script> whose src names embed-sdk. There is no built-in address: with
  // neither, COSIGN_URL is null and init() throws rather than frame a guess.
  function originOf(src) {
    if (!src) return null;
    try {
      var url = new URL(src);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      return url.origin;
    } catch (e) {
      return null;
    }
  }

  var COSIGN_URL = (function () {
    var current = document.currentScript;
    var fromCurrent = current && originOf(current.src);
    if (fromCurrent) return fromCurrent;
    var scripts = document.querySelectorAll('script[src*="embed-sdk"]');
    if (scripts.length > 0) {
      return originOf(scripts[scripts.length - 1].src);
    }
    return null;
  })();

  var CosignEmbed = {
    _iframe: null,
    _listeners: {},

    /**
     * Initialize the embed widget
     * @param {object} options
     * @param {string} options.containerId - DOM element ID to inject iframe into
     * @param {string} options.token - Fill session token
     * @param {string} [options.language] - Preferred language (en, vi, es)
     * @param {string} [options.height] - iframe height (default: '100%')
     * @param {Function} [options.onComplete] - Called when form is submitted
     * @param {Function} [options.onError] - Called on errors
     * @param {Function} [options.onReady] - Called when iframe is loaded
     * @param {Function} [options.onProgress] - Called on fill progress updates
     */
    init: function (options) {
      if (!options || !options.containerId || !options.token) {
        throw new Error('CosignEmbed.init requires containerId and token');
      }
      if (!COSIGN_URL) {
        throw new Error('CosignEmbed could not tell its Cô Sign address: load embed-sdk.js with a <script src> from your Cô Sign site');
      }

      var container = document.getElementById(options.containerId);
      if (!container) {
        throw new Error('Container element #' + options.containerId + ' not found');
      }

      // Store callbacks
      this._listeners = {
        onComplete: options.onComplete || function () {},
        onError: options.onError || function () {},
        onReady: options.onReady || function () {},
        onProgress: options.onProgress || function () {},
      };

      // Build iframe URL
      var embedUrl = COSIGN_URL + '/embed/' + options.token;
      if (options.language) {
        embedUrl += '?lang=' + encodeURIComponent(options.language);
      }

      // Create iframe
      var iframe = document.createElement('iframe');
      iframe.src = embedUrl;
      iframe.style.width = '100%';
      iframe.style.height = options.height || '100%';
      iframe.style.minHeight = '600px';
      iframe.style.border = 'none';
      iframe.style.borderRadius = '8px';
      iframe.allow = 'camera';  // For signature capture
      iframe.setAttribute('title', 'Cô Sign Document Fill');

      // Listen for postMessage events
      var self = this;
      window.addEventListener('message', function (event) {
        if (event.origin !== COSIGN_URL) return;
        if (!event.data || !event.data.type) return;

        switch (event.data.type) {
          case 'cosign:ready':
            self._listeners.onReady();
            break;
          case 'cosign:complete':
            self._listeners.onComplete(event.data.payload || {});
            break;
          case 'cosign:error':
            self._listeners.onError(event.data.payload || {});
            break;
          case 'cosign:progress':
            self._listeners.onProgress(event.data.payload || {});
            break;
          case 'cosign:resize':
            if (event.data.payload && event.data.payload.height) {
              iframe.style.height = event.data.payload.height + 'px';
            }
            break;
        }
      });

      // Clear container and insert iframe
      container.innerHTML = '';
      container.appendChild(iframe);
      this._iframe = iframe;
    },

    /**
     * Destroy the embed widget
     */
    destroy: function () {
      if (this._iframe && this._iframe.parentNode) {
        this._iframe.parentNode.removeChild(this._iframe);
      }
      this._iframe = null;
      this._listeners = {};
    },

    /**
     * Set language on the embedded form
     * @param {string} language - 'en', 'vi', or 'es'
     */
    setLanguage: function (language) {
      if (this._iframe) {
        this._iframe.contentWindow.postMessage({
          type: 'cosign:setLanguage',
          payload: { language: language },
        }, COSIGN_URL);
      }
    },
  };

  // Export
  root.CosignEmbed = CosignEmbed;

})(typeof window !== 'undefined' ? window : this);
