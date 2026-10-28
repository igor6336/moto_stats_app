// #/add/CODE: an invite link from a friend.
import { getMe, socialConfigured, humanError } from '../social/client.js';
import { addFriend } from '../social/friends.js';
import { copyCode } from './account.js';
import { escapeHtml } from '../format.js';
import { h, toast } from '../ui.js';
import { icon } from '../icons.js';

export function mountInvite(root, { params, navigate }) {
  const code = String(params.code || '').toUpperCase();
  const me = socialConfigured() ? getMe() : null;
  const el = h(`<section class="screen invite">
    <h1>Приглашение</h1>
    <div class="code-box">
      <span>Код друга</span>
      <b>${escapeHtml(code)}</b>
      ${me ? `<button class="btn primary" data-add>${icon('user-plus')}Добавить в друзья</button>`
        : `<button class="btn" data-copy>${icon('copy')}Копировать код</button>`}
    </div>
    <p class="hint">${me ? 'Друг увидит запрос и сможет его принять.'
      : 'Скопируйте код, откройте MotoHrust с экрана «Домой», войдите и вставьте код в разделе «Друзья».'}</p>
  </section>`);
  root.appendChild(el);
  el.querySelector('[data-copy]')?.addEventListener('click', () => copyCode(code));
  el.querySelector('[data-add]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      await addFriend(code);
      toast('Запрос отправлен');
      navigate('#/friends');
    } catch (err) {
      toast(humanError(err), 5000);
      e.currentTarget.disabled = false;
    }
  });
}
