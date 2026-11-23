export const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const button=(title,action,attr='',style='')=>`<button type="button" class="btn ${style}" data-action="${action}" ${attr}>${title}</button>`;
export const input=(label,name,type='text',value='',attrs='')=>`<div class="field"><label for="${h(name)}">${h(label)}</label><input id="${h(name)}" name="${h(name)}" type="${type}" value="${h(value)}" ${attrs}></div>`;
export const options=rows=>rows.map(([id,label])=>`<option value="${h(id)}">${h(label)}</option>`).join('');
export const select=(label,name,rows,value='',attrs='')=>`<div class="field"><label for="${h(name)}">${h(label)}</label><select id="${h(name)}" name="${h(name)}" ${attrs}>${rows.map(([id,title])=>`<option value="${h(id)}" ${String(id)===String(value)?'selected':''}>${h(title)}</option>`).join('')}</select></div>`;
export const textarea=(label,name,value='',attrs='')=>`<div class="field"><label for="${h(name)}">${h(label)}</label><textarea id="${h(name)}" name="${h(name)}" ${attrs}>${h(value)}</textarea></div>`;
export const empty=(title,detail)=>`<div class="empty"><strong>${h(title)}</strong><p class="hint">${h(detail)}</p></div>`;
export const table=(cols,rows)=>`<div class="table-scroll" role="region" tabindex="0" aria-label="Tabela com rolagem"><table><thead><tr>${cols.map(c=>`<th scope="col">${h(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
export const head=(title,desc,action='')=>`<div class="page-head"><div><h1>${h(title)}</h1><p>${h(desc)}</p></div><div class="actions">${action}</div></div>`;
export const metric=(title,n)=>`<section class="card"><p class="metric-label">${h(title)}</p><div class="metric-number">${h(n)}</div></section>`;
export const messageBubble=text=>`<div class="message-conversation"><p class="message-bubble">${h(text)}</p></div>`;
export const paginate=({page,hasMore,previous,next})=>`<nav class="pager" aria-label="Paginação">
  ${button('Página anterior',previous,page>1?'':'disabled','small')}
  <span class="hint">Página ${h(page)}</span>
  ${button('Próxima página',next,hasMore?'':'disabled','small')}
</nav>`;

export function confirmAction(title,detail,label){
  const dialog=document.getElementById('confirmation');
  if(dialog.open)return Promise.resolve(false);
  dialog.querySelector('#confirmation-title').textContent=title;
  dialog.querySelector('#confirmation-detail').textContent=detail;
  dialog.querySelector('[value=confirm]').textContent=label;
  dialog.returnValue='cancel';
  dialog.inert=false;
  return new Promise(resolve=>{
    dialog.addEventListener('close',()=>{
      dialog.inert=true;
      resolve(dialog.returnValue==='confirm');
    },{once:true});
    dialog.showModal();
  });
}
