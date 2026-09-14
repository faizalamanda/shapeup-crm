const crypto = require('crypto');

const cleanToken = "aat.NTA.eyJ2IjoxLCJ1Ijo3MzMwNDcsImQiOjI4NzE4NzUsImFpIjo3MjIzNSwiYWsiOiIxN2MxNzQ1Yi0zMTQ2LTQ2OGUtOTk1NC1jM2QwOTI4MDUzNGQiLCJhbiI6IlNoYXBlVXAgQ1JNIiwiYXAiOiJlZmE3NzA1Ni01Y2I1LTQ0MjAtYTAyMy00YWM0Y2ZhNmI4YjMiLCJ0IjoxNzg5MzU2NDc0MDA5fQ.LtuML/wOMnxatiDKTjiNtsspmtWEBb7TaPncvPP0GziqUXUVeRtiWS0LZ3XU6GCGLajaw2gWFPcQ/BvtofcZUTiKEZOs+pXNRjEbD4kuYdAVZFU2heeDmK0oL1z8r9ZVznGfzpsv0/yEDIBEe8cgXpBBD06PGQ7n1G+aNsDYi0q8s6ShJnCZQo7yNwX8OppM13XTjXjyNSc=.X30HOv7s8TZKm4l4ZpZ3fzDpMEgErz4abmDgUyTxXIk";
const cleanDbId = "01557500-2437-4723-9148-46f655379e30";
const cleanSecret = "CQr4RyMu3ocNZu9hxMw8U7Imqgui64io13xF7a7ymRMYW7HZSFiAenLXNFEt4PmB";

const accurateHost = 'https://account.accurate.id';

async function test() {
  const pad = (n) => n.toString().padStart(2, '0');
  const now = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Jakarta"}));
  const tsStr = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  
  console.log("Timestamp:", tsStr);
  const signature = crypto.createHmac('sha256', cleanSecret).update(tsStr).digest('base64');
  console.log("Signature:", signature);

  const tokenRes = await fetch(`${accurateHost}/api/api-token.do`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cleanToken}`,
      'X-Api-Timestamp': tsStr,
      'X-Api-Signature': signature
    }
  });

  const text = await tokenRes.text();
  console.log("Status:", tokenRes.status);
  console.log("Body:", text);
}

test().catch(console.error);
