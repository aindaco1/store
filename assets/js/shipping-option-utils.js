(function() {
'use strict';

  function normalizeSelection(availableOptions, selectedOption, defaultOption) {
    const options = Array.isArray(availableOptions) ? availableOptions : [];
    const requested = String(selectedOption || '').trim().toLowerCase();
    if (requested && options.some((option) => option?.id === requested)) {
      return requested;
    }

    const normalizedDefault = String(defaultOption || 'standard').trim().toLowerCase() || 'standard';
    if (options.some((option) => option?.id === normalizedDefault)) {
      return normalizedDefault;
    }

    return options[0]?.id || 'standard';
  }

  function getSelectedDetails(availableOptions, selectedOption, defaultOption) {
    const options = Array.isArray(availableOptions) ? availableOptions : [];
    const resolvedOption = normalizeSelection(options, selectedOption, defaultOption);
    return options.find((option) => option?.id === resolvedOption) || null;
  }

  function getPrimaryQuote(quotes) {
    const normalizedQuotes = Array.isArray(quotes) ? quotes : [];
    const shippableQuotes = normalizedQuotes.filter((quote) => (
      Number(quote?.shippingCents || 0) > 0 || quote?.shipment?.hasPhysical === true
    ));
    return shippableQuotes[0] || normalizedQuotes[0] || null;
  }

  function resolveQuote(payload, selectedOption, fallbackShippingCents) {
    const quotes = Array.isArray(payload?.quotes) ? payload.quotes : [];
    const primaryQuote = getPrimaryQuote(quotes);
    const shippableQuotes = quotes.filter((quote) => (
      Number(quote?.shippingCents || 0) > 0 || quote?.shipment?.hasPhysical === true
    ));
    const optionSourceQuote = shippableQuotes.length === 1 ? shippableQuotes[0] : primaryQuote;
    const availableOptions = shippableQuotes.length === 1 && Array.isArray(optionSourceQuote?.availableOptions)
      ? optionSourceQuote.availableOptions
      : [];
    const defaultOption = String(optionSourceQuote?.defaultOption || 'standard').trim().toLowerCase() || 'standard';
    const resolvedOption = normalizeSelection(
      availableOptions,
      selectedOption || optionSourceQuote?.selectedOption,
      defaultOption
    );
    const selectedDetails = getSelectedDetails(availableOptions, resolvedOption, defaultOption);
    const shippingCents = selectedDetails
      ? Math.max(0, Number(selectedDetails.shippingCents || 0))
      : Math.max(0, Number(payload?.totalShippingCents || fallbackShippingCents || 0));

    return {
      shippingCents,
      source: String(primaryQuote?.source || ''),
      availableOptions,
      defaultOption,
      selectedOption: resolvedOption
    };
  }

  function shouldShowOptions(quote) {
    const source = String(quote?.source || '').trim().toLowerCase();
    const availableOptions = Array.isArray(quote?.availableOptions) ? quote.availableOptions : [];
    const shippingCents = Math.max(0, Number(quote?.shippingCents ?? quote?.amountCents ?? 0));
    return source === 'usps_live' && shippingCents > 0 && availableOptions.length > 1;
  }

  function formatChoice(option, labelResolver, moneyFormatter) {
    if (!option) return '';
    const label = typeof labelResolver === 'function' ? labelResolver(option.id) : String(option?.label || option?.id || '');
    const delta = Math.max(0, Number(option?.priceDeltaCents || 0));
    if (delta <= 0) return label;
    const formattedDelta = typeof moneyFormatter === 'function' ? moneyFormatter(delta) : String(delta);
    return `${label} (+${formattedDelta})`;
  }

  const shippingOptionUtils = {
    normalizeSelection,
    getSelectedDetails,
    resolveQuote,
    shouldShowOptions,
    formatChoice
  };
  window.StoreShippingOptionUtils = shippingOptionUtils;
})();
