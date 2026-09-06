const readline = require('node:readline');
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
readline.createInterface({input: process.stdin}).on('line', line => {
 const msg = JSON.parse(line);
 if (msg.method === 'initialize') send({id:msg.id,result:{userAgent:'test'}});
 else if (msg.method === 'model/list') {
  const output = JSON.stringify({id:msg.id,result:{data:[{model:'test-model',displayName:'Test model'}],nextCursor:null}})+'\n';
  process.stdout.write(output.slice(0,15)); setTimeout(()=>process.stdout.write(output.slice(15)),5);
 }
 else if(msg.method === 'test/tool') send({id:'tool-1',method:'item/tool/call',params:{tool:'GetCanvasNode',arguments:{nodeId:'node-1'},replyId:msg.id}});
 else if(msg.id === 'tool-1') send({id:3,result:msg.result ?? msg.error});
 else if(msg.method === 'test/error') send({id:msg.id,error:{message:'model unavailable'}});
 else if(msg.method === 'test/exit') process.exit(2);
});
