# Deploy pe Cloudflare Pages

## Setări Pages

- Framework preset: `None`
- Build command: gol
- Build output directory: `/`
- Root directory: `/`

Pagina principală este `index.html`.

## Domeniu

În Cloudflare Pages, adaugă domeniul:

```text
modernmedclinic.ro
www.modernmedclinic.ro
```

Cloudflare va crea automat DNS-ul necesar dacă domeniul este în contul Cloudflare.

## Chestionar recenzii

Pentru ca formularul să funcționeze în producție, creează un KV namespace în Cloudflare:

```text
REVIEWS_KV
```

Leagă namespace-ul la proiectul Pages:

```text
Settings -> Functions -> KV namespace bindings
Variable name: REVIEWS_KV
```

Pentru email real, setează variabilele:

```text
REVIEW_TO=contact@modernmedclinic.ro
MAIL_FROM=Modern Med Clinic <contact@modernmedclinic.ro>
RESEND_API_KEY=cheia_din_resend
```

Fără `RESEND_API_KEY`, recenziile se pot salva în KV, dar nu se trimit emailuri de aprobare.

## După lansare

1. Testează `https://modernmedclinic.ro/robots.txt`
2. Testează `https://modernmedclinic.ro/sitemap.xml`
3. Intră în Google Search Console și trimite sitemap-ul:

```text
https://modernmedclinic.ro/sitemap.xml
```

4. Completează și verifică Google Business Profile pentru Modern Med Clinic.
