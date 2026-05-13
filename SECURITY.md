# Security Guidelines

## Handling Secrets Safely

### ❌ NEVER DO THIS:
- Commit real API keys or secrets to git
- Put secrets in source code files (.js, .jsx, .ts, etc.)
- Put secrets in .env file and commit it
- Share secrets in chat, emails, or GitHub issues

### ✅ DO THIS INSTEAD:

#### For Local Development:
1. Create a `.env` file in the `hanta-tracker/` directory (not committed to git)
2. Add your secrets there:
   ```
   NEWS_API_KEY=your_real_key_here
   ANTHROPIC_API_KEY=your_real_key_here
   CONTACT_EMAIL=your-email@example.com
   ```
3. The `.env` file is already in `.gitignore` so it won't be accidentally committed

#### For Vercel Deployment:
1. Go to your Vercel project dashboard
2. Navigate to Settings → Environment Variables
3. Add each secret as an environment variable:
   - `NEWS_API_KEY`: your NewsAPI key
   - `ANTHROPIC_API_KEY`: your Anthropic API key
   - `CONTACT_EMAIL`: your email
4. **Do NOT add these to vercel.json or any config file**
5. Vercel automatically injects these into your serverless functions at runtime

#### For GitHub Repository:
- The `.env` file is in `.gitignore` and will never be committed
- Use `.env.example` as a template showing what variables are needed
- `.env.example` contains ONLY placeholder values, never real secrets

## If You Accidentally Commit a Secret:

1. **Immediately rotate the exposed key** (generate a new one, disable the old one)
2. The old key is now compromised and anyone with access to the git history can see it
3. To remove it from git history, you would need to rewrite commits (dangerous operation)
4. Going forward, follow the guidelines above to prevent this

## Environment Variable Names:

- **Local development (.env file)**: Use any name needed by your app
- **Vercel deployment**: Set the exact same variable names in Vercel dashboard
- **Frontend code**: Only use variables that start with `VITE_` (e.g., `VITE_CONTACT_EMAIL`)
  - These are safely exposed in the browser
  - Never prefix API keys with `VITE_`

## Checklist:

- [ ] `.gitignore` includes `.env`
- [ ] `.env` file exists locally with real secrets
- [ ] `.env.example` has only placeholder values
- [ ] No real API keys in any `.js`, `.jsx`, `.ts`, `.tsx` files
- [ ] No real API keys in `vercel.json`, `package.json`, or config files
- [ ] Secrets are set in Vercel dashboard, not in code
