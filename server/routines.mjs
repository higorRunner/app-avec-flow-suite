const formatters = new Map();
export const ruleTypes = ['post_service','csat','return','birthday','inactive','cross_sell'];

export function localDay(date, zone) {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }));
  const parts = Object.fromEntries(formatters.get(zone).formatToParts(date).map(x=>[x.type,x.value]));
  return { day:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}` };
}

function addDays(day, count) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0,10);
}

export function candidates({ unit, rule, contacts, appointments, services, jobs, now = new Date(), preview = false }) {
  if (!ruleTypes.includes(rule.type) || (!preview && (!rule.enabled || !rule.armed_at))) return [];
  const today = localDay(now,unit.timezone);
  if (today.time < rule.send_time.slice(0,5)) return [];
  if (!preview && localDay(new Date(rule.armed_at),unit.timezone).day === today.day &&
      localDay(new Date(rule.armed_at),unit.timezone).time > rule.send_time.slice(0,5)) return [];
  const relevant = appointments.filter(a=>!a.canceled);
  const due = [];
  for (const contact of contacts) {
    if (!contact.consent) continue;
    const history = relevant.filter(a=>a.contact_id===contact.id);
    let event;
    if (rule.type === 'birthday') {
      const anniversary = addDays(today.day,-rule.delay_days);
      if (contact.birthday?.slice(5)!==anniversary.slice(5)) continue;
      event = { key:'birthday:'+anniversary,service:null,appointment:null };
    } else {
      const past = history.filter(a=>a.completed_at && new Date(a.completed_at)<=now)
        .sort((a,b)=>Date.parse(b.completed_at)-Date.parse(a.completed_at));
      const matching = past.filter(a=>!rule.service_id || a.service_id===rule.service_id);
      if (rule.type==='inactive') {
        if (!past[0] || (rule.service_id && past[0].service_id!==rule.service_id) ||
            history.some(a=>!a.completed_at && new Date(a.scheduled_at)>now)) continue;
        const day = addDays(localDay(new Date(past[0].completed_at),unit.timezone).day,rule.delay_days);
        if (day!==today.day) continue;
        event = {key:past[0].id,appointment:past[0],service:services.find(s=>s.id===past[0].service_id)};
      } else {
        const appointment = matching.find(a=>{
          const service = services.find(s=>s.id===a.service_id);
          const delay = rule.type==='return' ? service?.return_days??rule.delay_days : rule.delay_days;
          return addDays(localDay(new Date(a.completed_at),unit.timezone).day,delay)===today.day;
        });
        if (!appointment) continue;
        if (rule.type==='return' && history.some(a=>a.service_id===appointment.service_id &&
          (a.completed_at>appointment.completed_at || (!a.completed_at && new Date(a.scheduled_at)>now)))) continue;
        const service = services.find(s=>s.id===(rule.type==='cross_sell'?rule.target_service_id:appointment.service_id));
        if (rule.type==='cross_sell' && (!service || history.some(a=>a.service_id===service.id &&
          (new Date(a.completed_at||a.scheduled_at)>new Date(appointment.completed_at))))) continue;
        event={key:appointment.id,appointment,service};
      }
    }
    const key=`rule:${rule.id}:${contact.id}:${event.key}`;
    const blocked=jobs.some(job=>job.idempotency_key===key || (job.rule_id===rule.id&&job.contact_id===contact.id&&
      ['queued','processing','accepted','sent','delivered','read'].includes(job.status) &&
      Date.parse(job.created_at)>now.getTime()-rule.cooldown_days*86400000));
    if (blocked) continue;
    due.push({contact,event,key});
  }
  return due;
}
