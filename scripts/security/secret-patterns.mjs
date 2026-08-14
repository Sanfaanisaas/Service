export const secretChecks = [
  {
    label: "credentialed MongoDB SRV URI",
    pattern: /mongodb\+srv:\/\/[^:\s/]+:[^@\s/]+@/g,
  },
  {
    label: "private key material",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    label: "non-empty Supabase service-role assignment",
    pattern:
      /SUPABASE_SERVICE_ROLE_KEY[ \t]*=[ \t]*(?!$|<|your-|replace-|changeme)([^\s#]+)/gim,
  },
  {
    label: "non-empty VAPID private-key assignment",
    pattern:
      /VAPID_PRIVATE_KEY[ \t]*=[ \t]*(?!$|<|your-|replace-|changeme)([^\s#]+)/gim,
  },
  {
    label: "non-empty password assignment",
    pattern:
      /\b[A-Z0-9_]*PASSWORD[ \t]*=[ \t]*(?!$|<|your-|replace-|changeme)([^\s#]+)/gim,
  },
  {
    label: "JWT-like bearer token",
    pattern:
      /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
];
