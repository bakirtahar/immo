/* immo – réglages de connexion à Supabase.
   Renseignez les deux valeurs de votre projet (Supabase > Project Settings > API) :
   - supabaseUrl     : « Project URL », ex. https://abcdefghijkl.supabase.co
   - supabaseAnonKey : clé publique « anon public » (ou « publishable »).
   Ces deux valeurs sont publiques par nature : la sécurité repose sur les règles
   d'accès de la base (supabase/schema.sql). Ne mettez JAMAIS ici la clé
   « service_role » ou « secret ». */
window.IMMO_CONFIG = {
  supabaseUrl: 'https://VOTRE-PROJET.supabase.co',
  supabaseAnonKey: 'VOTRE-CLE-PUBLIQUE-ANON',
  // Adresse publique du site (sous-domaine du cabinet).
  siteUrl: 'https://immo.cabinet-tb.tn/',
  // Fermeture automatique de la session après inactivité (minutes, 5 à 240).
  inactivityMinutes: 30
};
