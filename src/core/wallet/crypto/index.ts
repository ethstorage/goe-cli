import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv, CipherGCM, CipherGCMTypes } from 'crypto';

export function encrypt(data: string, password: string): string {
    const salt = randomBytes(16) as Buffer;
    const key = pbkdf2Sync(password, salt, 100000, 32, 'sha256') as Buffer;
    const iv = randomBytes(12) as Buffer;
    const cipher: CipherGCM = createCipheriv('aes-256-gcm', key, iv, {authTagLength: 16});
    const encrypted = Buffer.concat([cipher.update(data, 'utf8') as Buffer, cipher.final() as Buffer]);
    const authTag = cipher.getAuthTag() as Buffer;
    return [
        salt.toString('hex'),
        iv.toString('hex'),
        authTag.toString('hex'),
        encrypted.toString('hex')
    ].join(':');
}

export function decrypt(encryptedStr: string, key: Buffer): string {
    const [saltHex, ivHex, authTagHex, encryptedHex] = encryptedStr.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = createDecipheriv(
        'aes-256-gcm' as CipherGCMTypes,
        key,
        iv,
        { authTagLength: 16 }
    );
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
        decipher.update(encrypted) as Buffer,
        decipher.final() as Buffer
    ]);

    return decrypted.toString('utf8');
}

export function deriveKey(password: string, saltHex: string): string {
    const salt = Buffer.from(saltHex, 'hex') as Buffer;
    const key = pbkdf2Sync(password, salt, 100000, 32, 'sha256') as Buffer;
    return key.toString('hex');
}
