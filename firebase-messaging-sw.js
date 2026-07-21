/* SP Car Clean — Service Worker do Firebase Cloud Messaging
 * Recebe notificações push com o app fechado ou em segundo plano.
 * A apiKey é injetada no build (build.js) — as demais chaves não são secretas.
 */
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: '%%FIREBASE_API_KEY%%',
  authDomain: 'sp-car-clean.firebaseapp.com',
  databaseURL: 'https://sp-car-clean-default-rtdb.firebaseio.com',
  projectId: 'sp-car-clean',
  storageBucket: 'sp-car-clean.firebasestorage.app',
  messagingSenderId: '726947312422',
  appId: '1:726947312422:web:f6a0bcebc57f19b3f107e7'
});

const messaging = firebase.messaging();

// Mensagens data-only: montamos a notificação manualmente (controle total do clique).
messaging.onBackgroundMessage((payload) => {
  const d = (payload && payload.data) || {};
  const title = d.title || '🔔 SP Car Clean';
  self.registration.showNotification(title, {
    body: d.body || 'Nova atividade no painel.',
    icon: '/assets/favicon.png',
    badge: '/assets/favicon.png',
    tag: d.tag || 'spcc-admin',
    renotify: true,
    data: { link: d.link || '/?admin' }
  });
});

// Clique na notificação → foca uma aba aberta do portal ou abre o painel admin.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/?admin';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ('focus' in w) { w.navigate && w.navigate(link); return w.focus(); }
      }
      return self.clients.openWindow(link);
    })
  );
});
