import { Router } from 'express';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { prisma } from '../lib/prisma';
import * as fs from 'fs';
import * as path from 'path';

export const shareRouter = Router();

const LIFE_SCORE_URL = process.env.LIFE_SCORE_URL || 'http://localhost:5173';
const API_URL = process.env.API_URL || 'http://localhost:4000';

// Tailwind emerald palette
const colors = {
  emerald900: '#064e3b',
  emerald300: '#6ee7b7',
  emerald200: '#a7f3d0',
  white: '#ffffff',
};

// Load Manrope font (cached in memory)
let fontData: ArrayBuffer | null = null;

async function loadFont(): Promise<ArrayBuffer> {
  if (fontData) return fontData;

  const fontPath = path.join(__dirname, '../../assets/Manrope-Bold.woff');
  const buffer = fs.readFileSync(fontPath);
  fontData = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  return fontData;
}

// Generate OG image
shareRouter.get('/og-image/:scoreId', async (req, res) => {
  try {
    const { scoreId } = req.params;

    const lifeScore = await prisma.lifeScore.findUnique({
      where: { id: scoreId },
      include: { user: true },
    });

    if (!lifeScore) {
      return res.status(404).send('Score not found');
    }

    const font = await loadFont();
    const name = lifeScore.user.displayName;
    const score = lifeScore.score.toString();
    const statusText = lifeScore.statusText;

    // Build the score line: "7 • Feeling good" or just "7"
    const scoreLine = statusText ? `${score} • ${statusText}` : score;

    // Build children array
    const children: any[] = [
      // Score (large)
      {
        type: 'div',
        props: {
          style: {
            fontSize: '120px',
            color: colors.emerald300,
            lineHeight: 1,
          },
          children: score,
        },
      },
    ];

    // Status text (if present)
    if (statusText) {
      children.push({
        type: 'div',
        props: {
          style: {
            fontSize: '36px',
            color: colors.emerald200,
            textAlign: 'center',
            maxWidth: '700px',
            marginTop: '16px',
          },
          children: statusText,
        },
      });
    }

    // Name (larger, closer to status)
    children.push({
      type: 'div',
      props: {
        style: {
          fontSize: '32px',
          color: colors.white,
          marginTop: '20px',
        },
        children: name,
      },
    });

    const svg = await satori(
      {
        type: 'div',
        props: {
          style: {
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            backgroundColor: colors.emerald900,
            padding: '48px',
          },
          children,
        },
      } as any,
      {
        width: 800,
        height: 418,
        fonts: [
          {
            name: 'Manrope',
            data: font,
            weight: 700,
            style: 'normal',
          },
        ],
        loadAdditionalAsset: async (code: string, segment: string) => {
          if (code === 'emoji') {
            // Fetch emoji from Twemoji CDN
            const emojiCode = segment.codePointAt(0)?.toString(16);
            const url = `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/${emojiCode}.svg`;
            const response = await fetch(url);
            if (response.ok) {
              const svg = await response.text();
              return `data:image/svg+xml,${encodeURIComponent(svg)}`;
            }
          }
          return '';
        },
      }
    );

    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: 800 },
    });
    const pngBuffer = resvg.render().asPng();

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(pngBuffer);
  } catch (error) {
    console.error('Error generating OG image:', error);
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).send(`Error generating image: ${message}`);
  }
});

// Escape user-controlled text before putting it in HTML (element text or attribute values)
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// IDs are UUIDs; anything else in the query string is ignored
const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

// Share page with OG meta tags
shareRouter.get('/score/:scoreId', async (req, res) => {
  try {
    const { scoreId } = req.params;
    const rawGroupId = req.query.groupId;
    const groupId = typeof rawGroupId === 'string' && ID_PATTERN.test(rawGroupId) ? rawGroupId : undefined;

    const lifeScore = await prisma.lifeScore.findUnique({
      where: { id: scoreId },
      include: { user: true },
    });

    if (!lifeScore) {
      return res.status(404).send('Score not found');
    }

    const title = `${lifeScore.user.displayName}'s Vibe Check`;
    const description = lifeScore.statusText
      ? `${lifeScore.score} • ${lifeScore.statusText}`
      : `${lifeScore.score}`;
    const imageUrl = `${API_URL}/vibe-check/share/og-image/${encodeURIComponent(lifeScore.id)}`;
    const pageUrl = groupId
      ? `${LIFE_SCORE_URL}/group/${groupId}/score/${encodeURIComponent(lifeScore.id)}`
      : `${LIFE_SCORE_URL}`;

    const safeTitle = escapeHtml(title);
    const safeDescription = escapeHtml(description);
    const safeImageUrl = escapeHtml(imageUrl);
    const safePageUrl = escapeHtml(pageUrl);
    // JSON-encode for the script context, and stop "</script>" from closing the tag early
    const scriptPageUrl = JSON.stringify(pageUrl).replace(/</g, '\\u003c');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>

  <meta property="og:type" content="website">
  <meta property="og:url" content="${safePageUrl}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:image" content="${safeImageUrl}">
  <meta property="og:image:width" content="800">
  <meta property="og:image:height" content="418">
  <meta property="og:site_name" content="Vibe Check">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDescription}">
  <meta name="twitter:image" content="${safeImageUrl}">

  <meta http-equiv="refresh" content="0;url=${safePageUrl}">
</head>
<body>
  <p>Redirecting to Vibe Check...</p>
  <script>window.location.href = ${scriptPageUrl};</script>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  } catch (error) {
    console.error('Error generating share page:', error);
    return res.status(500).send('Error generating share page');
  }
});
