// Follow dependency IDs transitively; a cycle must not include the original source.
export function downstreamItems(items, sourceIds) {
  const sources=new Set(sourceIds), affected=new Set(sources);
  let changed=true;
  while(changed){changed=false;for(const item of items)if(!affected.has(item.id)&&(item.dependsOn||[]).some(id=>affected.has(id))){affected.add(item.id);changed=true;}}
  return items.filter(item=>affected.has(item.id)&&!sources.has(item.id));
}
export function sameWorkDefinition(a,b) {
  return a.title===b.title&&a.owner===b.owner&&(a.detail||'')===(b.detail||'')&&JSON.stringify(a.acceptance||[])===JSON.stringify(b.acceptance||[])&&JSON.stringify([...(a.dependsOn||[])].sort())===JSON.stringify([...(b.dependsOn||[])].sort());
}
export function invalidateDownstream(items,sourceIds,reason) {
  for(const item of downstreamItems(items,sourceIds)){
    if(item.status==='TODO')continue;
    item.recheck=reason;
    item.status=item.owner==='human'||!item.outputs?.length?'TODO':'AWAITING_REVIEW';
    if(item.review)item.review={...item.review,superseded:true};
    delete item.doneAt;
  }
}
