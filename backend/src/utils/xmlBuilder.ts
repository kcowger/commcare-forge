/**
 * Thin wrapper around @xmldom/xmldom for building CommCare XML documents.
 *
 * Eliminates string concatenation for XML generation — the DOM handles
 * escaping, namespace management, and structural correctness automatically.
 */
import { DOMImplementation, XMLSerializer, DOMParser } from '@xmldom/xmldom'

const impl = new DOMImplementation()
const serializer = new XMLSerializer()
const parser = new DOMParser()

/**
 * Create a new XML document with an optional root element and namespaces.
 */
export function createDocument(rootTag: string, namespaces?: Record<string, string>): Document {
  const doc = impl.createDocument(null, rootTag, null)
  if (namespaces && doc.documentElement) {
    for (const [prefix, uri] of Object.entries(namespaces)) {
      if (prefix === '') {
        doc.documentElement.setAttribute('xmlns', uri)
      } else {
        doc.documentElement.setAttribute(`xmlns:${prefix}`, uri)
      }
    }
  }
  return doc
}

/**
 * Create an element with optional attributes and text content.
 */
export function el(doc: Document, tag: string, attrs?: Record<string, string>, text?: string): Element {
  const elem = doc.createElement(tag)
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      elem.setAttribute(key, value)
    }
  }
  if (text !== undefined) {
    elem.appendChild(doc.createTextNode(text))
  }
  return elem
}

/**
 * Create a namespaced element (e.g., h:html, h:head).
 */
export function elNS(doc: Document, ns: string, tag: string, attrs?: Record<string, string>, text?: string): Element {
  const elem = doc.createElementNS(ns, tag)
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      elem.setAttribute(key, value)
    }
  }
  if (text !== undefined) {
    elem.appendChild(doc.createTextNode(text))
  }
  return elem
}

/**
 * Serialize a document to a formatted XML string.
 */
export function serialize(doc: Document): string {
  const xml = serializer.serializeToString(doc)
  // Avoid double XML declaration — xmldom may include one, and we prepend one
  if (xml.startsWith('<?xml')) return xml
  return '<?xml version="1.0"?>\n' + xml
}

/**
 * Parse an XML string into a Document.
 */
export function parseXml(xml: string): Document {
  return parser.parseFromString(xml, 'text/xml')
}

/**
 * Append multiple children to a parent element.
 */
export function appendChildren(parent: Element, children: Element[]): void {
  for (const child of children) {
    parent.appendChild(child)
  }
}
