'use strict';
// Formats for the places this media ends up. Each sets sensible defaults;
// anything passed explicitly (aspectRatio, imageSize, resolution...) wins.
// Edit freely — this is the house list, not a provider constraint.

const FORMATS = {
  'blog-hero':       { label: 'Blog post hero',          image: { aspectRatio: '16:9', imageSize: '2K' }, video: { aspectRatio: '16:9', resolution: '1080p' } },
  'website-banner':  { label: 'Website banner (wide)',   image: { aspectRatio: '21:9', imageSize: '2K' }, video: { aspectRatio: '16:9', resolution: '1080p' } },
  'og-image':        { label: 'Link preview / OG image', image: { aspectRatio: '16:9', imageSize: '1K' } },
  'inline':          { label: 'In-article image',        image: { aspectRatio: '3:2', imageSize: '2K' } },
  'social-square':   { label: 'Social post (square)',    image: { aspectRatio: '1:1', imageSize: '2K' } },
  'social-portrait': { label: 'Social post (4:5)',       image: { aspectRatio: '4:5', imageSize: '2K' } },
  'story':           { label: 'Story / Reel (9:16)',     image: { aspectRatio: '9:16', imageSize: '2K' }, video: { aspectRatio: '9:16', resolution: '1080p' } },
  'signage-landscape': { label: 'In-store screen (landscape)', image: { aspectRatio: '16:9', imageSize: '4K' }, video: { aspectRatio: '16:9', resolution: '1080p' } },
  'signage-portrait':  { label: 'In-store screen (portrait)',  image: { aspectRatio: '9:16', imageSize: '4K' }, video: { aspectRatio: '9:16', resolution: '1080p' } },
};

// Appended to the prompt when chosen. Keep them short: the prompt itself
// should carry the subject; a style only steers the look.
const STYLES = {
  none: { label: 'No added style', text: '' },
  photo: { label: 'Editorial photo', text: 'Photorealistic editorial photograph, natural light, shot on a full-frame camera, shallow depth of field, true-to-life colour.' },
  'ph-brand': { label: 'Personalisation Hub look', text: 'Clean, modern retail-technology aesthetic: bright, uncluttered spaces, real shoppers and staff, digital screens in store, subtle teal (#169bc2) and violet (#9747ff) accents, plenty of negative space for a headline. No text or logos unless asked.' },
  illustration: { label: 'Flat illustration', text: 'Flat vector illustration, simple geometric shapes, limited palette of teal #169bc2, violet #9747ff and soft greys on white, no text.' },
  cinematic: { label: 'Cinematic', text: 'Cinematic, anamorphic look, soft contrast, gentle camera movement, shallow depth of field.' },
};

function applyPreset(kind, input) {
  const out = { ...input };
  const fmt = input.preset ? FORMATS[input.preset] : null;
  if (input.preset && !fmt) {
    const err = new Error(`Unknown preset "${input.preset}". Use one of: ${Object.keys(FORMATS).join(', ')}`);
    err.status = 400;
    throw err;
  }
  for (const [k, v] of Object.entries(fmt?.[kind] || {})) if (out[k] == null || out[k] === '') out[k] = v;
  const style = input.style ? STYLES[input.style] : null;
  if (input.style && !style) {
    const err = new Error(`Unknown style "${input.style}". Use one of: ${Object.keys(STYLES).join(', ')}`);
    err.status = 400;
    throw err;
  }
  out.originalPrompt = String(input.prompt || '').trim();
  out.prompt = style?.text ? `${out.originalPrompt}\n\nStyle: ${style.text}` : out.originalPrompt;
  return out;
}

module.exports = { FORMATS, STYLES, applyPreset };
