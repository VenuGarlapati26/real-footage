// Languages. English is the channel's main language; every episode must have it.
//
//   VOICE languages  (a full dubbed render is possible): en, hi, es, pt, fr, it   (Kokoro / Google / Gemini all speak them)
//   SUBTITLE languages: any of the above. Every language an episode has text for is uploaded as a subtitle track on
//   the same video (YouTube shows it to viewers whose app is in that language), which is how one video reaches
//   India, Latin America, Brazil and Europe at once.
//
// channel/settings.json: "lang": "en" (what the video is voiced and titled in), "subtitles": ["en", "hi", "es", "pt"].

export type Lang = "en" | "hi" | "es" | "pt" | "fr" | "it";
export type Txt = { en: string } & Partial<Record<Exclude<Lang, "en">, string>>;

export const LANGS: Record<Lang, { name: string; native: string; script: "latin" | "deva"; ui: Record<string, string> }> = {
  en: { name: "English", native: "English", script: "latin", ui: { comments: "Tell us in the comments", footage: "Footage", own: "Our own footage", tag: "REAL FOOTAGE", full: "Full video", sources: "Sources", synthetic: "The narration voice is synthetic (AI).", promise: "Every video on this channel is built from real footage. No AI video.", nasa: "NASA footage is public domain; its use does not imply NASA endorsement.", more: "Full video on our YouTube channel.", creditsNote: "(Footage credits and sources are in the description)" } },
  hi: { name: "Hindi", native: "हिन्दी", script: "deva", ui: { comments: "कमेंट में बताइए", footage: "फुटेज", own: "हमारी अपनी फुटेज", tag: "असली फुटेज", full: "पूरा वीडियो", sources: "स्रोत", synthetic: "नैरेशन की आवाज़ सिंथेटिक (AI) है।", promise: "इस चैनल पर हर वीडियो असली फुटेज से बना है। कोई AI वीडियो नहीं।", nasa: "NASA की फुटेज public domain है; इसका मतलब NASA का समर्थन नहीं है।", more: "पूरा वीडियो हमारे YouTube चैनल पर।", creditsNote: "(फुटेज और स्रोत डिस्क्रिप्शन में हैं)" } },
  es: { name: "Spanish", native: "Español", script: "latin", ui: { comments: "Cuéntanos en los comentarios", footage: "Imágenes", own: "Imágenes propias", tag: "IMÁGENES REALES", full: "Video completo", sources: "Fuentes", synthetic: "La voz de la narración es sintética (IA).", promise: "Cada video de este canal está hecho con imágenes reales. Sin video de IA.", nasa: "Las imágenes de la NASA son de dominio público; su uso no implica respaldo de la NASA.", more: "Video completo en nuestro canal de YouTube.", creditsNote: "(Créditos y fuentes en la descripción)" } },
  pt: { name: "Portuguese", native: "Português", script: "latin", ui: { comments: "Conta pra gente nos comentários", footage: "Imagens", own: "Imagens próprias", tag: "IMAGENS REAIS", full: "Vídeo completo", sources: "Fontes", synthetic: "A voz da narração é sintética (IA).", promise: "Todo vídeo deste canal é feito com imagens reais. Nada de vídeo de IA.", nasa: "As imagens da NASA são de domínio público; o uso não implica endosso da NASA.", more: "Vídeo completo no nosso canal do YouTube.", creditsNote: "(Créditos e fontes na descrição)" } },
  fr: { name: "French", native: "Français", script: "latin", ui: { comments: "Dites-le-nous en commentaire", footage: "Images", own: "Nos propres images", tag: "IMAGES RÉELLES", full: "Vidéo complète", sources: "Sources", synthetic: "La voix de la narration est synthétique (IA).", promise: "Chaque vidéo de cette chaîne est faite d'images réelles. Aucune vidéo IA.", nasa: "Les images de la NASA sont dans le domaine public ; leur usage n'implique aucun soutien de la NASA.", more: "Vidéo complète sur notre chaîne YouTube.", creditsNote: "(Crédits et sources dans la description)" } },
  it: { name: "Italian", native: "Italiano", script: "latin", ui: { comments: "Dicci nei commenti", footage: "Immagini", own: "Immagini nostre", tag: "IMMAGINI REALI", full: "Video completo", sources: "Fonti", synthetic: "La voce narrante è sintetica (IA).", promise: "Ogni video di questo canale è fatto di immagini reali. Niente video IA.", nasa: "Le immagini NASA sono di pubblico dominio; il loro uso non implica approvazione della NASA.", more: "Video completo sul nostro canale YouTube.", creditsNote: "(Crediti e fonti nella descrizione)" } },
};

/** The text in `lang`, falling back to English. */
export const tx = (t: Txt | undefined, lang: Lang): string => (t ? (t[lang as keyof Txt] as string | undefined) ?? t.en : "");
export const has = (t: Txt | undefined, lang: Lang) => !!t && !!t[lang as keyof Txt];
export const ui = (lang: Lang, key: string) => LANGS[lang]?.ui[key] ?? LANGS.en.ui[key];
export const isLang = (x: string): x is Lang => x in LANGS;
