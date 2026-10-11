import { Server } from 'node:net';

// 測試若誤用 socket，立即失敗，避免悄悄啟動 server。
Server.prototype.listen = function () { throw new Error('本次自動驗收禁止監聽連接埠。'); };
