const xmlNs = 'http://www.w3.org/2000/xmlns/';
const xhtmlNs = 'http://www.w3.org/1999/xhtml';
const svgNs = 'http://www.w3.org/2000/svg';
const doctype = '<?xml version="1.0" standalone="no"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [<!ENTITY nbsp "&#160;">]>';
const urlRegex = /url\(["']?(.+?)["']?\)/;
const fontFormats = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  otf: 'application/x-font-opentype',
  ttf: 'application/x-font-ttf',
  eot: 'application/vnd.ms-fontobject',
  sfnt: 'application/font-sfnt',
  svg: 'image/svg+xml'
};
const isElement = obj => obj instanceof HTMLElement || obj instanceof SVGElement;
const requireDomNode = el => {
  if (!isElement(el)) throw new Error(`an HTMLElement or SVGElement is required; got ${el}`);
};
const requireDomNodePromise = el =>
  new Promise((resolve, reject) => {
    if (isElement(el)) resolve(el)
    else reject(new Error(`an HTMLElement or SVGElement is required; got ${el}`));
  })
const isExternal = url => url && url.lastIndexOf('http',0) === 0 && url.lastIndexOf(window.location.host) === -1;

const getFontMimeTypeFromUrl = fontUrl => {
  const formats = Object.keys(fontFormats)
    .filter(extension => fontUrl.indexOf(`.${extension}`) > 0)
    .map(extension => fontFormats[extension]);
  if (formats) return formats[0];
  console.error(`Unknown font format for ${fontUrl}. Fonts may not be working correctly.`);
  return 'application/octet-stream';
};

const arrayBufferToBase64 = buffer => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary);
}

const getDimension = (el, clone, dim) => {
  const v =
    (el.viewBox && el.viewBox.baseVal && el.viewBox.baseVal[dim]) ||
    (clone.getAttribute(dim) !== null && !clone.getAttribute(dim).match(/%$/) && parseInt(clone.getAttribute(dim))) ||
    el.getBoundingClientRect()[dim] ||
    parseInt(clone.style[dim]) ||
    parseInt(window.getComputedStyle(el).getPropertyValue(dim));
  return typeof v === 'undefined' || v === null || isNaN(parseFloat(v)) ? 0 : v;
};

const getDimensions = (el, clone, width, height) => {
  if (el.tagName === 'svg') return {
    width: width || getDimension(el, clone, 'width'),
    height: height || getDimension(el, clone, 'height')
  };
  else if (el.getBBox) {
    const {x, y, width, height} = el.getBBox();
    return {
      width: x + width,
      height: y + height
    };
  }
};

const reEncode = data =>
  decodeURIComponent(
    encodeURIComponent(data)
      .replace(/%([0-9A-F]{2})/g, (match, p1) => {
        const c = String.fromCharCode(`0x${p1}`);
        return c === '%' ? '%25' : c;
      })
  );

const uriToBlob = uri => {
  const byteString = window.atob(uri.split(',')[1]);
  const mimeString = uri.split(',')[0].split(':')[1].split(';')[0]
  const buffer = new ArrayBuffer(byteString.length);
  const intArray = new Uint8Array(buffer);
  for (let i = 0; i < byteString.length; i++) {
    intArray[i] = byteString.charCodeAt(i);
  }
  return new Blob([buffer], {type: mimeString});
};

const query = (el, selector) => {
  if (!selector) return;
  try {
    return el.querySelector(selector) || el.parentNode && el.parentNode.querySelector(selector);
  } catch(err) {
    console.warn(`Invalid CSS selector "${selector}"`, err);
  }
};

const detectCssFont = (rule, href) => {
  // Match CSS font-face rules to external links.
  // @font-face {
  //   src: local('Abel'), url(https://fonts.gstatic.com/s/abel/v6/UzN-iejR1VoXU2Oc-7LsbvesZW2xOQ-xsNqO47m55DA.woff2);
  // }
  const match = rule.cssText.match(urlRegex);
  const url = (match && match[1]) || '';
  if (!url || url.match(/^data:/) || url === 'about:blank') return;
  const fullUrl =
    url.startsWith('../') ? `${href}/../${url}`
    : url.startsWith('./') ? `${href}/.${url}`
    : url;
  return {
    text: rule.cssText,
    format: getFontMimeTypeFromUrl(fullUrl),
    url: fullUrl
  };
};

const inlineImages = el => Promise.all(
  Array.from(el.querySelectorAll('image')).map(image => {
    let href = image.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || image.getAttribute('href');
    if (!href) return Promise.resolve(null);
    if (isExternal(href)) {
      href += (href.indexOf('?') === -1 ? '?' : '&') + 't=' + new Date().valueOf();
    }
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = href;
      img.onerror = () => reject(new Error(`Could not load ${href}`));
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0);
        image.setAttributeNS('http://www.w3.org/1999/xlink', 'href', canvas.toDataURL('image/png'));
        resolve(true);
      };
    });
  })
);

const cachedFonts = {};
const inlineFonts = fonts => Promise.all(
  fonts.map(font =>
    new Promise((resolve, reject) => {
      if (cachedFonts[font.url]) return resolve(cachedFonts[font.url]);

      const req = new XMLHttpRequest();
      req.addEventListener('load', () => {
        // TODO: it may also be worth it to wait until fonts are fully loaded before
        // attempting to rasterize them. (e.g. use https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet)
        const fontInBase64 = arrayBufferToBase64(req.response);
        const fontUri = font.text.replace(urlRegex, `url("data:${font.format};base64,${fontInBase64}")`)+'\n';
        cachedFonts[font.url] = fontUri;
        resolve(fontUri);
      });
      req.addEventListener('error', e => {
        console.warn(`Failed to load font from: ${font.url}`, e);
        cachedFonts[font.url] = null;
        resolve(null);
      });
      req.addEventListener('abort', e => {
        console.warn(`Aborted loading font from: ${font.url}`, e);
        resolve(null);
      });
      req.open('GET', font.url);
      req.responseType = 'arraybuffer';
      req.send();
    })
  )
).then(fontCss => fontCss.filter(x => x).join(''));

const styleSheetRules = (cachedRules?) => {
  if (cachedRules) return cachedRules;
  return cachedRules = Array.from(document.styleSheets).map(sheet => {
    try {
      return {rules: sheet.cssRules, href: sheet.href};
    } catch (e) {
      console.warn(`Stylesheet could not be loaded: ${sheet.href}`, e);
      return {};
    }
  });
};

const inlineCss = (el, options) => {
  const {
    selectorRemap,
    modifyStyle,
    modifyCss,
    fonts,
    excludeUnusedCss
  } = options || {};
  const generateCss = modifyCss || ((selector, properties) => {
    const sel = selectorRemap ? selectorRemap(selector) : selector;
    const props = modifyStyle ? modifyStyle(properties) : properties;
    return `${sel}{${props}}\n`;
  });
  const css = [];
  const detectFonts = typeof fonts === 'undefined';
  const fontList = fonts || [];
  styleSheetRules().forEach(({rules, href}) => {
    if (!rules) return;
    Array.from(rules).forEach(rule => {
      if (typeof rule.style != 'undefined') {
        if (query(el, rule.selectorText)) css.push(generateCss(rule.selectorText, rule.style.cssText));
        else if (detectFonts && rule.cssText.match(/^@font-face/)) {
          const font = detectCssFont(rule, href);
          if (font) fontList.push(font);
        } else if (!excludeUnusedCss) {
          css.push(rule.cssText);
        }
      }
    });
  });

  return inlineFonts(fontList).then(fontCss => css.join('\n') + fontCss);
};

const downloadOptions = () => {
  if (!navigator.msSaveOrOpenBlob && !('download' in document.createElement('a'))) {
    return {popup: window.open()};
  }
};

export default class SaveSvgAsPng {
    
}