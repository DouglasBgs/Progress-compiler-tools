import * as bcrypt from 'bcrypt';

const password = process.argv[2];

if (!password) {
    console.error('Uso: npm run hash-password -- <senha>');
    process.exit(1);
}

bcrypt.hash(password, 10).then((hash) => {
    console.log('Copie o valor abaixo para DASHBOARD_PASSWORD_HASH no .env:');
    console.log(hash);
});
