/**
 * Compress a data-URL or remote image for vault storage.
 * Always resolves to a JPEG data URL when possible; never throws.
 */
export const compressImage = (
  base64Str: string,
  maxWidth = 800,
  quality = 0.5
): Promise<string> => {
  return new Promise((resolve) => {
    if (!base64Str || typeof base64Str !== 'string') {
      resolve('');
      return;
    }

    // Already small enough JPEG — skip re-encode unless oversized
    if (
      base64Str.startsWith('data:image/jpeg') &&
      base64Str.length < 40_000 &&
      maxWidth >= 600
    ) {
      resolve(base64Str);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'Anonymous';

    const finish = (src: string) => resolve(src || base64Str);

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        let width = img.naturalWidth || img.width || 1;
        let height = img.naturalHeight || img.height || 1;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        // Cap total pixels for extreme panoramas
        const maxPixels = maxWidth * maxWidth * 1.5;
        if (width * height > maxPixels) {
          const scale = Math.sqrt(maxPixels / (width * height));
          width = Math.max(1, Math.round(width * scale));
          height = Math.max(1, Math.round(height * scale));
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          finish(base64Str);
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        finish(canvas.toDataURL('image/jpeg', quality));
      } catch (e) {
        console.warn('compressImage draw failed:', e);
        finish(base64Str);
      }
    };

    img.onerror = () => {
      console.warn('compressImage load failed; using original or empty');
      // Prefer empty over a multi-MB payload that will crash Firestore
      if (base64Str.length > 500_000) {
        finish('');
      } else {
        finish(base64Str);
      }
    };

    img.src = base64Str;
  });
};
