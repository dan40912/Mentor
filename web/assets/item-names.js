// 同一份顯示規則供 classic script 與 Node 使用；資料中的 id 保持原值。
(function () {
  function itemName(id) {
    if (id === 'W0') return '骨架版';
    const match = /^(W|R)(\d+)$/.exec(id);
    if (!match) return id;
    return match[1] === 'W' ? `第 ${Number(match[2])} 項` : `第 ${Number(match[2]) + 1} 輪`;
  }
  function itemNames(ids) {
    if (ids.length > 1 && ids.every(id => /^W[1-9]\d*$/.test(id))) {
      return `第 ${ids.map(id => Number(id.slice(1))).join('、')} 項`;
    }
    return ids.map(itemName).join('、');
  }
  globalThis.itemName = itemName;
  globalThis.itemNames = itemNames;
})();
