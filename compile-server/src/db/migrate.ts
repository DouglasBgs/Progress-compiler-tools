import { AppDataSource } from './data-source';

AppDataSource.initialize()
    .then(() => {
        console.log('Banco de dados inicializado e tabelas criadas com sucesso.');
        return AppDataSource.destroy();
    })
    .catch((err) => {
        console.error('Falha ao inicializar banco de dados:', err);
        process.exit(1);
    });
