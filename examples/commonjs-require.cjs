const { IntronClient, INTRON_STT_LANGUAGES } = require('intron-voice-node');

const client = new IntronClient({
  apiKey: process.env.INTRON_API_KEY,
});

console.log(INTRON_STT_LANGUAGES.map((language) => language.code));
console.log(client.getConfig().baseUrl.toString());
