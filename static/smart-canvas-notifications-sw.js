'use strict';

function safeNotificationTarget(rawUrl){
    try {
        const target = new URL(String(rawUrl || ''), self.location.origin);
        return target.origin === self.location.origin
            ? target.href
            : new URL('/static/smart-canvas.html', self.location.origin).href;
    } catch(_error) {
        return new URL('/static/smart-canvas.html', self.location.origin).href;
    }
}

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const targetUrl = safeNotificationTarget(event.notification.data?.url);
    event.waitUntil((async () => {
        const windowClients = await self.clients.matchAll({
            type:'window',
            includeUncontrolled:true
        });
        const target = new URL(targetUrl);
        const exactClient = windowClients.find(client => client.url === targetUrl);
        const canvasClient = exactClient || windowClients.find(client => {
            try {
                const current = new URL(client.url);
                return current.origin === target.origin && current.pathname === target.pathname;
            } catch(_error) {
                return false;
            }
        });
        if(canvasClient){
            let focusClient = canvasClient;
            if(canvasClient.url !== targetUrl && 'navigate' in canvasClient){
                try { focusClient = await canvasClient.navigate(targetUrl) || canvasClient; } catch(_error) {}
            }
            if('focus' in focusClient) return focusClient.focus();
        }
        if(self.clients.openWindow) return self.clients.openWindow(targetUrl);
        return undefined;
    })());
});
