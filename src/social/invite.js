// Inviting friends: the code travels as a share-sheet message with a link.
// The link opens the app (Safari or the home screen app) on #/add/CODE,
// which adds the friend at once when signed in, or shows the code to copy.
import { toast } from '../ui.js';

export function inviteLink(code) {
  return `${location.origin}${location.pathname}#/add/${encodeURIComponent(code)}`;
}

export async function shareInvite(me) {
  const text = `Добавь меня в MotoHrust: мой код ${me.public_id}`;
  const url = inviteLink(me.public_id);
  if (navigator.share) {
    try { await navigator.share({ title: 'MotoHrust', text, url }); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Приглашение скопировано'); } catch { toast(url, 6000); }
}
