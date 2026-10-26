// Avatars are stored as small JPEG data URLs in the profile row.
const SIZE = 192;

export async function fileToAvatar(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('не удалось прочитать фото'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    canvas.getContext('2d').drawImage(
      img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE,
    );
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Avatars come from other users: only accept image data URLs.
export function safeAvatar(src) {
  return typeof src === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src) ? src : null;
}

export function avatarHtml(profile, cls = 'avatar') {
  const src = safeAvatar(profile?.avatar);
  if (src) return `<img class="${cls}" src="${src}" alt="">`;
  const initial = (profile?.name || '?').trim().charAt(0).toUpperCase() || '?';
  return `<span class="${cls} avatar-empty">${initial.replace(/[&<>"']/g, '')}</span>`;
}
