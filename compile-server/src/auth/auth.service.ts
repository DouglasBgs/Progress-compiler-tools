import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_EXPIRES_IN = '1h';

export interface JwtPayload {
    username: string;
}

export async function login(username: string, password: string): Promise<string | null> {
    const expectedUser = process.env.DASHBOARD_USER;
    const expectedHash = process.env.DASHBOARD_PASSWORD_HASH;

    if (!expectedUser || !expectedHash || !JWT_SECRET) {
        throw new Error('DASHBOARD_USER, DASHBOARD_PASSWORD_HASH ou JWT_SECRET não configurados no ambiente.');
    }

    if (username !== expectedUser) {
        return null;
    }

    const isValid = await bcrypt.compare(password, expectedHash);
    if (!isValid) {
        return null;
    }

    return jwt.sign({ username } as JwtPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JwtPayload | null {
    if (!JWT_SECRET) {
        return null;
    }
    try {
        return jwt.verify(token, JWT_SECRET) as JwtPayload;
    } catch {
        return null;
    }
}
