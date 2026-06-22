(function() {
  'use strict';

  var script = document.currentScript ||
    document.querySelector('script[data-store-config-script]');
  if (!script) return;

  var dataset = script.dataset || {};
  var currentLang = dataset.currentLang || 'en';
  var platformName = dataset.platformName || 'Store';
  var platformCompanyName = dataset.platformCompanyName || platformName;
  var platformAuthor = dataset.platformAuthor || platformCompanyName;
  var supportEmail = dataset.platformSupportEmail || '';
  var platformTimezone = isValidTimeZone(dataset.platformTimezone) ? dataset.platformTimezone : 'America/Denver';
  var siteUrl = dataset.siteUrl || '';
  var workerBase = dataset.workerBase || '';
  var defaultCreatorName = dataset.defaultCreatorName || platformCompanyName;
  var salesTaxRate = dataset.salesTaxRate || '0.07875';
  var flatShippingRate = dataset.flatShippingRate || '3.00';
  var shippingOriginZip = dataset.shippingOriginZip || '';
  var shippingOriginCountry = dataset.shippingOriginCountry || 'US';
  var shippingFallbackFlatRate = dataset.shippingFallbackFlatRate || '3.00';
  var shippingFreeShippingDefault = dataset.shippingFreeShippingDefault || 'false';
  var shippingCountries = [];
  var defaultTipPercent = dataset.defaultTipPercent || '5';
  var maxTipPercent = dataset.maxTipPercent || '15';
  var liveInventoryCacheTtlSeconds = dataset.liveInventoryCacheTtlSeconds || '300';
  var cartRuntime = 'first_party';
  var checkoutProvider = 'first_party';
  var checkoutUiMode = 'custom';
  var stripePublishableKey = dataset.stripePublishableKey || '';
  var seoXHandle = dataset.seoXHandle || '';
  var debugConsoleLoggingEnabled = dataset.debugConsoleLoggingEnabled || 'true';
  var debugVerboseConsoleLogging = dataset.debugVerboseConsoleLogging || 'true';
  var runtimeMessages = {};
  var shippingPresets = {};
  var addOns = {};

  if (dataset.runtimeMessages) {
    try {
      runtimeMessages = JSON.parse(dataset.runtimeMessages);
    } catch (_error) {
      runtimeMessages = {};
    }
  }

  if (dataset.shippingPresets) {
    try {
      shippingPresets = JSON.parse(dataset.shippingPresets);
    } catch (_error) {
      shippingPresets = {};
    }
  }

  if (dataset.addOns) {
    try {
      addOns = JSON.parse(dataset.addOns);
    } catch (_error) {
      addOns = {};
    }
  }

  if (dataset.shippingCountries) {
    try {
      shippingCountries = JSON.parse(dataset.shippingCountries);
    } catch (_error) {
      shippingCountries = [];
    }
  }

  function isValidTimeZone(timeZone) {
    if (!timeZone || typeof Intl === 'undefined' || typeof Intl.DateTimeFormat !== 'function') return false;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timeZone }).format(new Date());
      return true;
    } catch (_error) {
      return false;
    }
  }

  function getTimeZoneFormatter(timeZone) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: isValidTimeZone(timeZone) ? timeZone : 'America/Denver',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    });
  }

  function getTimeZoneParts(date, timeZone) {
    var parts = getTimeZoneFormatter(timeZone).formatToParts(date instanceof Date ? date : new Date(date));
    var map = {};
    parts.forEach(function(part) {
      if (part.type !== 'literal') map[part.type] = part.value;
    });
    var hour = Number(map.hour || 0) || 0;
    return {
      year: Number(map.year || 0) || 0,
      month: Number(map.month || 0) || 0,
      day: Number(map.day || 0) || 0,
      hour: hour === 24 ? 0 : hour,
      minute: Number(map.minute || 0) || 0,
      second: Number(map.second || 0) || 0
    };
  }

  function getTimeZoneOffsetMs(date, timeZone) {
    var parts = getTimeZoneParts(date, timeZone);
    var localAsUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return localAsUtcMs - date.getTime();
  }

  function dateAtTimeInTimeZone(dateString, hour, minute, second, timeZone) {
    var match = String(dateString || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return new Date(NaN);
    var safeTimeZone = isValidTimeZone(timeZone) ? timeZone : platformTimezone;
    var localAsUtcMs = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour || 0, minute || 0, second || 0);
    var firstGuess = new Date(localAsUtcMs);
    var firstOffset = getTimeZoneOffsetMs(firstGuess, safeTimeZone);
    var firstResult = new Date(localAsUtcMs - firstOffset);
    var correctedOffset = getTimeZoneOffsetMs(firstResult, safeTimeZone);
    return new Date(localAsUtcMs - correctedOffset);
  }

  var storeTime = {
    defaultTimeZone: 'America/Denver',
    platformTimeZone: platformTimezone,
    getPlatformTimeZone: function() {
      return platformTimezone;
    },
    dateAtTimeInTimeZone: dateAtTimeInTimeZone
  };

  window.STORE_TIME = storeTime;
  window.StoreTime = storeTime;

  var runtimeConfig = {
    i18n: {
      currentLang: currentLang,
      messages: runtimeMessages
    },
    platform: {
      name: platformName,
      companyName: platformCompanyName,
      author: platformAuthor,
      supportEmail: supportEmail,
      siteUrl: siteUrl,
      workerUrl: workerBase,
      defaultCreatorName: defaultCreatorName,
      timezone: platformTimezone
    },
    pricing: {
      salesTaxRate: salesTaxRate,
      flatShippingRate: flatShippingRate,
      defaultTipPercent: defaultTipPercent,
      maxTipPercent: maxTipPercent
    },
    shipping: {
      originZip: shippingOriginZip,
      originCountry: shippingOriginCountry,
      fallbackFlatRate: shippingFallbackFlatRate,
      freeShippingDefault: shippingFreeShippingDefault,
      countries: shippingCountries,
      presets: shippingPresets
    },
    addOns: addOns,
    cache: {
      liveInventoryTtlSeconds: liveInventoryCacheTtlSeconds
    },
    checkout: {
      cartRuntime: cartRuntime,
      provider: checkoutProvider,
      uiMode: checkoutUiMode,
      stripePublishableKey: stripePublishableKey
    },
    seo: {
      xHandle: seoXHandle
    },
    debug: {
      consoleLoggingEnabled: debugConsoleLoggingEnabled,
      verboseConsoleLogging: debugVerboseConsoleLogging
    },
    siteUrl: siteUrl,
    workerBase: workerBase,
    platformName: platformName,
    platformCompanyName: platformCompanyName,
    platformAuthor: platformAuthor,
    platformTimezone: platformTimezone,
    supportEmail: supportEmail,
    defaultCreatorName: defaultCreatorName,
    salesTaxRate: salesTaxRate,
    flatShippingRate: flatShippingRate,
    shippingOriginZip: shippingOriginZip,
    shippingOriginCountry: shippingOriginCountry,
    shippingFallbackFlatRate: shippingFallbackFlatRate,
    shippingFreeShippingDefault: shippingFreeShippingDefault,
    shippingCountries: shippingCountries,
    defaultTipPercent: defaultTipPercent,
    maxTipPercent: maxTipPercent,
    liveInventoryCacheTtlSeconds: liveInventoryCacheTtlSeconds,
    cartRuntime: cartRuntime,
    checkoutProvider: checkoutProvider,
    checkoutUiMode: checkoutUiMode,
    stripePublishableKey: stripePublishableKey,
    seoXHandle: seoXHandle,
    debugConsoleLoggingEnabled: debugConsoleLoggingEnabled,
    debugVerboseConsoleLogging: debugVerboseConsoleLogging
  };

  window.STORE_CONFIG = runtimeConfig;
  window.StoreConfig = runtimeConfig;
})();
