export function isHiddenSlideXml(slideXml) {
  const root = slideXml.match(/<p:sld\b[^>]*>/i)?.[0] ?? '';
  return /\bshow=(?:"0"|'0'|"false"|'false')/i.test(root);
}

export function mapRenderedPagesToSlides({ pageCount, slideNumbers, hiddenSlideNumbers = [] }) {
  const hidden = new Set(hiddenSlideNumbers);
  const visibleSlideNumbers = slideNumbers.filter((slideNumber) => !hidden.has(slideNumber));
  let renderedSlideNumbers = null;

  if (pageCount === slideNumbers.length) renderedSlideNumbers = slideNumbers;
  else if (pageCount === visibleSlideNumbers.length) renderedSlideNumbers = visibleSlideNumbers;

  if (!renderedSlideNumbers) {
    throw new Error(
      `Rendered PDF page count ${pageCount} does not match PPT slide count ${slideNumbers.length} `
      + `or visible slide count ${visibleSlideNumbers.length}.`,
    );
  }

  return renderedSlideNumbers;
}
