import { Request, Response, NextFunction } from 'express';
import { verifyToken } from './auth.service';

declare module 'express-serve-static-core' {
    interface Request {
        user?: { username: string };
    }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ status: 'error', message: 'Token de autenticação ausente.' });
    }

    const token = authHeader.substring('Bearer '.length);
    const payload = verifyToken(token);

    if (!payload) {
        return res.status(401).json({ status: 'error', message: 'Token inválido ou expirado.' });
    }

    req.user = payload;
    next();
}
