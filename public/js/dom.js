/**
 * Safe DOM construction helpers for Project Pay.
 * Strictly uses document.createElement and textContent to eliminate XSS risks.
 */

/**
 * Creates a DOM element with safe properties and children.
 * String/number children are converted to text nodes, avoiding innerHTML.
 *
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {...(Node|string|number|null|undefined|Array)} children
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, ...children) {
  const element = document.createElement(tag);

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined) {
        continue;
      }

      if (key === 'className' || key === 'class') {
        element.className = String(value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        const eventName = key.substring(2).toLowerCase();
        element.addEventListener(eventName, value);
      } else if (key === 'dataset' && typeof value === 'object') {
        for (const [dKey, dVal] of Object.entries(value)) {
          element.dataset[dKey] = String(dVal);
        }
      } else if (typeof value === 'boolean') {
        if (value) {
          element.setAttribute(key, '');
        } else {
          element.removeAttribute(key);
        }
        if (key in element) {
          element[key] = value;
        }
      } else {
        element.setAttribute(key, String(value));
        if (key === 'value' && 'value' in element) {
          element.value = String(value);
        }
      }
    }
  }

  appendChildren(element, children);

  return element;
}

/**
 * Appends children recursively and safely.
 *
 * @param {Node} parent
 * @param {Array} children
 */
function appendChildren(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    if (Array.isArray(child)) {
      appendChildren(parent, child);
    } else if (child instanceof Node) {
      parent.appendChild(child);
    } else {
      parent.appendChild(document.createTextNode(String(child)));
    }
  }
}

/**
 * Clears all children from an element.
 *
 * @param {HTMLElement} element
 */
export function clearElement(element) {
  if (!element) return;
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}
