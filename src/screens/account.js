import { socialConfigured, getMe, onMeChange, signIn, signUp, signOut, updateProfile, humanError } from '../social/client.js';
import { syncRides } from '../social/rides.js';
import { fileToAvatar, avatarHtml } from '../social/avatar.js';
import { escapeHtml } from '../format.js';
import { h, toast } from '../ui.js';

export function mountAccount(root, { navigate }) {
  const el = h('<section class="screen account"></section>');
  root.appendChild(el);
  let mode = 'login'; // login | register | edit
  let avatar = null;   // pending avatar data URL in forms

  function render() {
    if (!socialConfigured()) {
      el.innerHTML = `<h1>Аккаунт</h1>
        <div class="empty">Сервер друзей ещё не подключён. Запись поездок работает без него.</div>`;
      return;
    }
    const me = getMe();
    if (me && mode !== 'edit') return renderProfile(me);
    if (me) return renderForm('edit', me);
    renderForm(mode);
  }

  function renderProfile(me) {
    el.innerHTML = `
      <h1>Аккаунт</h1>
      <div class="profile-card">
        ${avatarHtml(me, 'avatar xl')}
        <div>
          <div class="pc-name">${escapeHtml(me.name)}</div>
          <div class="pc-bike">${escapeHtml(me.bike || 'мотоцикл не указан')}</div>
          <div class="pc-login">@${escapeHtml(me.login)}</div>
        </div>
      </div>
      <div class="code-box">
        <span>Ваш код для друзей</span>
        <b data-code>${escapeHtml(me.public_id)}</b>
        <button class="btn" data-copy>Скопировать код</button>
      </div>
      <div class="actions">
        <button class="btn" data-edit>Изменить профиль</button>
        <button class="btn danger ghost" data-logout>Выйти</button>
      </div>`;
    el.querySelector('[data-copy]').addEventListener('click', () => copyCode(me.public_id));
    el.querySelector('[data-edit]').addEventListener('click', () => { mode = 'edit'; avatar = null; render(); });
    el.querySelector('[data-logout]').addEventListener('click', async () => {
      if (!confirm('Выйти из аккаунта? Поездки на телефоне останутся.')) return;
      await signOut();
      mode = 'login';
      render();
    });
  }

  function renderForm(kind, me = null) {
    const reg = kind === 'register', edit = kind === 'edit';
    el.innerHTML = `
      <h1>${edit ? 'Профиль' : reg ? 'Регистрация' : 'Вход'}</h1>
      ${edit ? '' : `<div class="seg">
        <button class="${reg ? '' : 'on'}" data-mode="login">Вход</button>
        <button class="${reg ? 'on' : ''}" data-mode="register">Регистрация</button>
      </div>`}
      <form data-form autocomplete="on">
        ${reg || edit ? `
          <div class="avatar-pick">
            <label class="avatar-btn">
              <span data-avatar>${avatarHtml(avatar ? { avatar } : me || { name: '+' }, 'avatar xl')}</span>
              <input type="file" accept="image/*" data-file hidden>
            </label>
            <small>Нажмите, чтобы выбрать фото</small>
          </div>
          <label class="field"><span>Имя</span><input name="name" maxlength="40" required value="${escapeHtml(me?.name || '')}"></label>
          <label class="field"><span>Мотоцикл</span><input name="bike" maxlength="60" placeholder="Yamaha R6" value="${escapeHtml(me?.bike || '')}"></label>` : ''}
        ${edit ? '' : `
          <label class="field"><span>Логин</span><input name="login" autocapitalize="none" autocorrect="off" spellcheck="false"
            autocomplete="username" pattern="[a-zA-Z0-9_]{3,24}" required>
            ${reg ? '<small>3–24 символа: латиница, цифры, _. Нужен для входа на другом телефоне.</small>' : ''}</label>
          <label class="field"><span>Пароль</span><input name="password" type="password" minlength="6" required
            autocomplete="${reg ? 'new-password' : 'current-password'}"></label>`}
        <button class="btn primary" type="submit">${edit ? 'Сохранить' : reg ? 'Зарегистрироваться' : 'Войти'}</button>
        ${edit ? '<button class="btn ghost" type="button" data-cancel>Отмена</button>' : ''}
      </form>`;

    el.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.mode;
      avatar = null;
      render();
    }));
    el.querySelector('[data-cancel]')?.addEventListener('click', () => { mode = 'login'; render(); });
    el.querySelector('[data-file]')?.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        avatar = await fileToAvatar(f);
        el.querySelector('[data-avatar]').innerHTML = avatarHtml({ avatar }, 'avatar xl');
      } catch (err) { toast(err.message); }
    });
    const form = el.querySelector('[data-form]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      const v = Object.fromEntries(new FormData(form));
      btn.disabled = true;
      try {
        if (edit) {
          const patch = { name: v.name.trim(), bike: v.bike.trim() };
          if (avatar) patch.avatar = avatar;
          await updateProfile(patch);
          mode = 'login';
          toast('Профиль сохранён');
        } else if (reg) {
          await signUp({ ...v, avatar });
          toast('Готово! Покажите друзьям свой код');
        } else {
          await signIn(v);
          toast('Вы вошли');
        }
        syncRides().catch(() => {});
        render();
      } catch (err) {
        toast(humanError(err), 5000);
      } finally {
        btn.disabled = false;
      }
    });
  }

  const off = onMeChange(() => render());
  render();
  return off;
}

export async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    toast('Код скопирован');
  } catch {
    toast(code);
  }
}
