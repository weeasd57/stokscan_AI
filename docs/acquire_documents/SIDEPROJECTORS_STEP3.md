# SideProjectors Step 3 Inputs

Here are the recommended inputs for Step 3 on SideProjectors:

---

### 1. Languages
`JavaScript, Python, TypeScript`

### 2. Frameworks
`React, Next.js`

### 3. Libraries & Packages
`Tailwind CSS, LightGBM, Optuna, Scikit-learn, Pandas, Joblib`

### 4. Databases
`PostgreSQL, Supabase`

### 5. Hosting & Infrastructure
`Vercel, Hugging Face`

### 6. Third-Party SaaS & APIs
`Telegram Bot API`

### 7. Any other information you want to share about how this project was built?
The project is split into two components: a serverless frontend built with Next.js and React, hosted on Vercel, and a daily automated Python engine hosted on Hugging Face Spaces. It uses Supabase (PostgreSQL) for a unified data store and authentication. 

Machine Learning models (LightGBM/Optuna) are used to rank and filter EGX stock signals. A KNN cosine-similarity search engine calculates historical chart pattern similarities. Real-time portfolio triggers are continuously evaluated and pushed to subscribers via the Telegram Bot API.
