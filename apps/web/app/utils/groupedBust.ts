// 首页 grouped 接口的边缘缓存较长（max-age=300 + SWR），后台增删改源/手动抓取后，
// 操作者希望前台立即看到效果。这里用一个进程内 bust token：后台操作后 bump，
// 下次 fetchGroupedArticles 携带该 token 作为查询参数，使 URL 不同、穿透边缘缓存拿到最新数据。
// 普通读者不 bump，继续命中长缓存，配额收益不受影响。token 仅存在于前端内存，
// 刷新页面即重置（无意间变成普通读者，符合预期）。
let groupedBust = 0;

export function bumpGroupedBust(): void {
  groupedBust = Date.now();
}

export function getGroupedBust(): number {
  return groupedBust;
}
