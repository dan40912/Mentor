// 本次驗收禁止監聽連接埠；NODE_OPTIONS 也會讓測試啟動的 Node 子程序套用。
const net = require('node:net');
net.Server.prototype.listen = function () {
  throw new Error('UI_COPY_LISTEN_FORBIDDEN: 本次驗收不可啟動監聽連接埠');
};
