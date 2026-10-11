// npm test 預載此防護；HTTP 與 TCP 共用這個入口，拒絕時尚未綁定埠。
import { Server } from 'node:net';

Server.prototype.listen = function () {
  // 即使呼叫端捕捉錯誤，該測試程序仍必須以失敗結束。
  process.exitCode = 1;
  throw new Error('TEST_LISTEN_FORBIDDEN：測試請直接呼叫 request handler，不可監聽埠。');
};
