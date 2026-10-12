import { TaskError } from './tasks.js';

const invalid = reason => new TaskError(400, 'TEST_COMMAND_INVALID', `測試指令無法使用：${reason}`);

// 只解析程式與參數，不展開變數、glob 或 shell 運算。
export function parseTestCommand(command) {
  if (typeof command !== 'string' || command.length > 6000) throw invalid('請提供 6000 字內的文字。');
  const args = [];
  let word = '', quote = '', started = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (/[\r\n\0]/.test(c)) throw invalid('不支援換行或空字元。');
    if (c === '\\' && quote !== "'") {
      const next = command[++i];
      if (next === undefined || /[\r\n\0]/.test(next)) throw invalid('跳脫字元後缺少有效字元。');
      word += next; started = true; continue;
    }
    if (quote) {
      if (c === quote) quote = '';
      else {
        if (quote === '"' && /[$`]/.test(c)) throw invalid('不支援變數或命令展開。');
        word += c;
      }
      continue;
    }
    if (c === '"' || c === "'") { quote = c; started = true; continue; }
    if (/[|&;<>$`()]/.test(c)) throw invalid('不支援 shell 運算語法，請只填一個程式與參數。');
    if (/\s/.test(c)) {
      if (started) { args.push(word); word = ''; started = false; }
    } else { word += c; started = true; }
  }
  if (quote) throw invalid('引號未關閉。');
  if (started) args.push(word);
  if (args.length && (!args[0] || /^[A-Za-z_][\w]*=/.test(args[0]))) throw invalid('請以程式名稱開頭。');
  return args;
}

export function normalizeTestCommand(command) {
  parseTestCommand(command);
  return command.trim();
}
