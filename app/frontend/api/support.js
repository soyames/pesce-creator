import { createSupportTicket } from '../lib/firestore.js';
import { telegramUserFromInitData, validateTelegramInitData } from '../lib/telegram-auth.js';
export default async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({message:'Méthode non autorisée.'});
 const token=process.env.TELEGRAM_PESCE_BOT_TOKEN;if(!token)return res.status(503).json({message:'Support Telegram non configuré.'});
 try{const b=typeof req.body==='string'?JSON.parse(req.body):req.body||{},initData=typeof b.initData==='string'?b.initData:'';if(!validateTelegramInitData(initData,token))return res.status(401).json({message:'Session Telegram invalide ou expirée.'});
  const user=telegramUserFromInitData(initData),message=String(b.message||'').trim().slice(0,4000);if(!message)return res.status(400).json({message:'Décrivez votre problème avant d’envoyer la demande.'});
  const ticketId=`PS-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;
  await createSupportTicket({id:ticketId,chatId:user?.id||null,userId:String(user?.id||''),username:user?.username||null,firstName:user?.first_name||null,message,status:'open',source:'mini_app'});
  await telegram(token,'sendMessage',{chat_id:user.id,text:`Votre demande de support ${ticketId} a bien été reçue.\n\nNous vous répondrons ici dès que possible.`});
  await notifyCreator(token,`Nouvelle demande de support 🛟\nTicket: ${ticketId}\nUtilisateur: ${user?.username?'@'+user.username:user?.first_name||user?.id}`);
  return res.status(200).json({ok:true,ticketId});
 }catch(e){console.error(e);return res.status(500).json({message:'Impossible d’enregistrer votre demande pour le moment.'});}
}
async function notifyCreator(token,text){const id=process.env.PESCE_CREATOR_TELEGRAM_USER_ID;if(id)try{await telegram(token,'sendMessage',{chat_id:id,text});}catch(e){console.error('creator notification failed',e);}}
async function telegram(token,method,payload){const r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),d=await r.json();if(!r.ok||!d.ok)throw Error(`Telegram ${method}: ${d.description||r.status}`);return d;}
