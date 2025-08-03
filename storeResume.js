import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

const RESUME_DIR = path.join(process.cwd(), 'resumes');
const META_DIR = path.join(process.cwd(), 'metadata');

// Créer les dossiers si inexistants
if (!fs.existsSync(RESUME_DIR)) fs.mkdirSync(RESUME_DIR, { recursive: true });
if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR, { recursive: true });

export const storeResume = (email, fileBuffer) => {
  const guid = uuidv4();
  const filePath = path.join(RESUME_DIR, `${guid}.pdf`);
  const metaPath = path.join(META_DIR, `${guid}.json`);

  // 1. Sauvegarder le PDF
  fs.writeFileSync(filePath, fileBuffer);

  // 2. Sauvegarder les métadonnées
  const meta = {
    email,
    createdAt: Date.now(),
    expiresAt: Date.now() + 7 * 24 * 3600 * 1000 // 7 jours
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta));

  return guid;
};