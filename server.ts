import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Share server-side Gemini AI Initialization
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// AI Chat Endpoint for Curriculum Assistant
app.post("/api/chat", async (req, res) => {
  try {
    const { message, context, history } = req.body;

    if (!message) {
      res.status(400).json({ error: "Pesan tidak boleh kosong." });
      return;
    }

    // Set up a strong, highly specialized system instruction
    const systemInstruction = `Anda adalah Asisten Administrasi Kurikulum & Pembelajaran AI (Wakil Kepala Sekolah Bidang Kurikulum) sekolah di Indonesia.
Tugas Anda adalah membantu guru menyusun administrasi pembelajaran, menganalisis hari efektif belajar (HEB), menyusun alokasi waktu RPP/Modul Ajar, menjadwalkan ujian, dan memberikan ide kegiatan non-akademik (seperti class meeting).

Berikut adalah data Kalender Pendidikan guru saat ini yang diatur lewat aplikasi:
- Tahun Pelajaran/Akademik: ${context?.academicYear || '2026/2027'}
- Hari Efektif Belajar (HEB): ${context?.hebCount || 0} hari
- Hari Efektif Kegiatan (HEK): ${context?.hekCount || 0} hari
- Jumlah Hari Libur Nasional: ${context?.lnCount || 0} hari
- Jumlah Hari Libur Sekolah: ${context?.lsCount || 0} hari
- Rincian Kegiatan Sekolah Terjadwal:
${context?.activitiesList ? context.activitiesList.map((a: string) => `  * ${a}`).join('\n') : '  * Belum ada kegiatan terplot'}

Panduan Menjawab:
1. Jawablah dalam bahasa Indonesia yang ramah, profesional, solutif, dan mudah dipahami oleh guru.
2. Gunakan visual formatting (markdown list, tabel jika diperlukan, heading tebal) agar mudah dibaca oleh guru yang sibuk.
3. Selalu hubungkan jawaban Anda dengan statistik kalender pendidikan guru di atas untuk memberikan rekomendasi nyata (contoh: "Dengan sisa ${context?.hebCount || 0} hari efektif...").
4. Berikan saran alokasi pertemuan atau distribusi bab pembelajaran secara taktis dan terstruktur.`;

    // Construct simple context prompt combined with history
    const formattedHistory = (history || []).map((h: any) => ({
      role: h.role === 'assistant' ? 'model' : h.role,
      parts: [{ text: h.content }]
    }));

    // Append current user message
    formattedHistory.push({
      role: 'user',
      parts: [{ text: message }]
    });

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: formattedHistory,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
      }
    });

    res.json({ reply: response.text });
  } catch (error: any) {
    console.error("Gemini API Error:", error);
    res.status(500).json({ error: error.message || "Terjadi kesalahan internal pada server AI." });
  }
});

// AI Endpoint: Generate Structured TP from CP (Capaian Pembelajaran -> Tujuan Pembelajaran)
app.post("/api/generate-tp-from-cp", async (req, res) => {
  try {
    const { subjectName, fase, classLevel, cpText, jpPerWeek = 4 } = req.body;

    if (!cpText || cpText.trim().length === 0) {
      res.status(400).json({ error: "Teks Capaian Pembelajaran (CP) tidak boleh kosong." });
      return;
    }

    const systemInstruction = `Anda adalah Pakar Pengembang Kurikulum Merdeka Kemendikbudristek.
Tugas Anda adalah membedah dan menurunkan naskah Capaian Pembelajaran (CP) menjadi butir-butir Tujuan Pembelajaran (TP) yang sistematis untuk 1 Tahun Ajaran (Semester 1 dan Semester 2).

Pedoman Penurunan CP ke TP:
1. Bedah naskah CP menjadi butir-butir Tujuan Pembelajaran (TP) yang berurutan secara pedagogis (disesuaikan secara proporsional dengan kedalaman dan keluasan materi CP: tidak baku 2 butir, dan bukan wajib harus lebih dari 2).
2. Rumuskan kalimat TP yang jelas (mengandung Kata Kerja Operasional/KKO dan Konten/Materi Pokok).
3. Bagi materi secara seimbang antara Semester 1 (Ganjil) dan Semester 2 (Genap).
4. Buat kode TP yang runtut: untuk Semester 1 (TP 1.1, TP 1.2, dst.), untuk Semester 2 (TP 2.1, TP 2.2, dst.).
5. Tentukan alokasi Jam Pelajaran (JP) yang realistis per bab (umumnya berkisar 8 - 24 JP per bab, total per semester sekitar ${(jpPerWeek || 4) * 16} s.d. ${(jpPerWeek || 4) * 18} JP).
6. Berikan hasil dalam format JSON yang valid persis sesuai skema yang diminta.`;

    const userPrompt = `Mata Pelajaran: ${subjectName || 'Mata Pelajaran'}
Fase: ${fase || 'Fase A'}
Tingkat Kelas: ${classLevel || 'Kelas 1 SD'}
Alokasi per Pekan: ${jpPerWeek || 4} JP/minggu

Naskah Capaian Pembelajaran (CP):
"""
${cpText}
"""

Tolong turunkan CP di atas menjadi daftar Tujuan Pembelajaran (TP) lengkap beserta Bab/Unit, Semester (1 atau 2), kode TP, dan alokasi JP per bab.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: userPrompt,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.3,
        responseMimeType: "application/json",
      }
    });

    const responseText = response.text || "{}";
    let parsedResult;
    try {
      parsedResult = JSON.parse(responseText);
    } catch (parseErr) {
      console.warn("JSON parse error, attempting regex extraction...", parseErr);
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Format respons AI tidak valid.");
      }
    }

    res.json({
      success: true,
      data: parsedResult
    });
  } catch (error: any) {
    console.error("Generate TP from CP error:", error);
    res.status(500).json({ error: error.message || "Gagal menurunkan CP menjadi TP via AI." });
  }
});

// AI Endpoint: Generate Complete Question Package (PG, PGK, Isian, Esai) based on CP/TP and Assessment Blueprint
app.post("/api/generate-questions-ai", async (req, res) => {
  try {
    const { 
      subjectName, 
      fase, 
      classLevel, 
      cpList, 
      counts = { pg: 10, pgKompleks: 5, isian: 5, esai: 5 }, 
      optionsCount = 4,
      bobot = { pg: 2, pgKompleks: 4, isian: 4, esai: 6 },
      stimulusTypePreference = 'campuran',
      stimulusTitle: customStimulusTitle,
      stimulusText: customStimulusText,
      stimulusTable: customStimulusTable,
      stimulusSvg: customStimulusSvg,
      stimulusImageUrl: customStimulusImageUrl
    } = req.body;

    if (!cpList || !Array.isArray(cpList) || cpList.length === 0) {
      res.status(400).json({ error: "Daftar Capaian Pembelajaran (CP) tidak boleh kosong." });
      return;
    }

    const totalPg = counts.pg || 0;
    const totalPgK = counts.pgKompleks || 0;
    const totalIsian = counts.isian || 0;
    const totalEsai = counts.esai || 0;
    const totalQuestions = totalPg + totalPgK + totalIsian + totalEsai;

    const cpSummary = cpList.map((c: any, idx: number) => {
      const tps = (c.tpList || []).map((t: any) => `- [${t.code || `TP ${idx+1}`}] ${t.text || ''} (Materi: ${t.materiPokok || c.materiPokok || 'Umum'})`).join('\n');
      return `CP ${idx + 1} [${c.code || `CP ${idx+1}`} - Elemen: ${c.elemen || 'Umum'}]:\nCP Text: "${c.capaianPembelajaran}"\nMateri Pokok: ${c.materiPokok || 'Umum'}\nDaftar TP:\n${tps || '- Sesuai teks CP'}`;
    }).join('\n\n');

    const isStimulusGabungan = stimulusTypePreference === 'gabungan' || stimulusTypePreference === 'campuran';
    const isStimulusTabel = stimulusTypePreference === 'tabel';
    const isStimulusGambar = stimulusTypePreference === 'gambar';

    let stimulusGuide = '';
    if (isStimulusGabungan) {
      stimulusGuide = `
PEDOMAN KHUSUS STIMULUS GABUNGAN (TEKS CERITA + TABEL DATA + GAMBAR VEKTOR/SVG):
Pengguna MEMILIH STIMULUS GABUNGAN. Butir-butir soal DILARANG HANYA BERUPA TEKS BIASA!
Wajib sebar luaskan variasi stimulus otentik pada setiap soal sebagai berikut:
1. SOAL BERSTIMULUS TABEL DATA (stimulusType: "tabel"):
   - "stimulusTitle": Judul tabel data kontekstual (contoh: "Tabel Data Penjualan Buku & Alat Tulis", "Tabel Frekuensi Nilai", "Tabel Kandungan Zat", "Tabel Jadwal Kegiatan")
   - "stimulusTable": Tuliskan tabel teks markdown/pipe rapi:
     "No | Nama Item / Aspek | Kuantitas | Keterangan\\n1 | Barang A | 15 unit | Lengkap\\n2 | Barang B | 25 unit | Baru"
   - "questionText": Pertanyaan WAJIB menganalisis angka/informasi pada tabel tersebut!
2. SOAL BERSTIMULUS GAMBAR / DIAGRAM SVG (stimulusType: "gambar"):
   - "stimulusTitle": Judul ilustrasi/diagram gambar
   - "stimulusSvg": Wajib gunakan salah satu preset visual atau kode SVG valid:
     * "math_fraction_3_4" (Pecahan lingkaran 3/4 berarsir)
     * "math_fraction_2_5" (Pecahan batang 2/5 berarsir)
     * "math_triangle_right" (Segitiga siku-siku alas dan tinggi)
     * "math_rectangle" (Persegi panjang dengan panjang & lebar)
     * "math_cuboid_3d" (Balok 3 dimensi)
     * "math_bar_chart" (Diagram batang frekuensi data)
     * "math_clock_0715" (Jam analog pukul 07.15)
     * "agama_wudhu_steps" (Urutan langkah berwudhu)
     * "agama_mizan_scale" (Timbangan amal perbuatan / Mizan)
     * "agama_kiblat_kaaba" (Arah kiblat dan Ka'bah)
     * ATAU kode SVG murni edukatif valid '<svg viewBox="0 0 ...">...</svg>'
   - "questionText": Pertanyaan WAJIB merujuk pada gambar/diagram tersebut!
3. SOAL BERSTIMULUS TEKS CERITA (stimulusType: "cerita"):
   - "stimulusTitle": Judul cerita wacana
   - "stimulusText": Cerita fabel, studi kasus, atau wacana kontekstual (3-5 kalimat).
4. SOAL BERSTIMULUS GABUNGAN LENGKAP (stimulusType: "gabungan"):
   - Memuat "stimulusTitle", "stimulusText" (wacana pengantar) DAN "stimulusTable" (tabel data) atau "stimulusSvg" (diagram visual).

DISTRIBUSI WAJIB: Minimal sepertiga soal harus memuat stimulus TABEL ("stimulusTable"), sepertiga memuat stimulus GAMBAR/DIAGRAM SVG ("stimulusSvg"), dan sepertiga memuat TEKS/GABUNGAN. DILARANG hanya menghasilkan teks cerita saja!`;
    } else if (isStimulusTabel) {
      stimulusGuide = `
PEDOMAN KHUSUS STIMULUS TABEL DATA:
Semua butir soal berstimulus harus menyertakan "stimulusTitle", "stimulusType": "tabel", dan "stimulusTable" berupa tabel markdown yang jelas dan terstruktur.`;
    } else if (isStimulusGambar) {
      stimulusGuide = `
PEDOMAN KHUSUS STIMULUS GAMBAR:
Semua butir soal berstimulus harus menyertakan "stimulusTitle", "stimulusType": "gambar", dan "stimulusSvg" (preset key: math_fraction_3_4, math_triangle_right, math_rectangle, math_cuboid_3d, math_bar_chart, math_clock_0715, agama_wudhu_steps, agama_mizan_scale, agama_kiblat_kaaba, atau kode SVG valid).`;
    }

    const systemInstruction = `Anda adalah Pakar Penilaian & Penulisan Butir Soal Asesmen Standar Pusmendik Kemendikbudristek dan Kemenag RI.
Tugas Anda adalah menyusun paket soal ujian lengkap, bermutu tinggi, dan kontekstual berdasarkan Capaian Pembelajaran (CP) dan Tujuan Pembelajaran (TP) yang diberikan.

PEDOMAN KETAT:
1. CAKUPAN MATERI: Pastikan SEMUA sub-topik esensial dalam naskah CP dibuatkan butir soal yang spesifik.
${stimulusGuide}
2. WAJIB MENGGUNAKAN STRUKTUR JSON DENGAN PROPERTI BERIKUT:
[
  {
    "number": 1,
    "type": "pg",
    "stimulusType": "gabungan",
    "stimulusTitle": "Judul stimulus",
    "stimulusText": "Teks cerita/wacana pengantar kontekstual",
    "stimulusTable": "Kolom 1 | Kolom 2 | Kolom 3\\nData 1 | Data 2 | Data 3",
    "stimulusSvg": "math_bar_chart",
    "questionText": "Tuliskan kalimat pertanyaan lengkap di sini. DILARANG KERAS menulis 'Pertanyaan nomor 1'!",
    "options": [
      { "label": "A", "text": "Pilihan A" },
      { "label": "B", "text": "Pilihan B" },
      { "label": "C", "text": "Pilihan C" },
      { "label": "D", "text": "Pilihan D" }
    ],
    "correctAnswer": "A",
    "cognitiveLevel": "L2",
    "materiPokok": "Nama materi pokok",
    "indikatorSoal": "Indikator spesifik",
    "rubrikPenilaian": "Kunci dan pembahasan"
  }
]

3. KETENTUAN JENIS SOAL:
- Nomor 1 s.d. ${totalPg}: Pilihan Ganda Tunggal (type: "pg"). Wajib sertakan "options" berisi ${optionsCount} opsi (A, B, C${optionsCount === 4 ? ', D' : ''}).
- Nomor ${totalPg + 1} s.d. ${totalPg + totalPgK}: Pilihan Ganda Kompleks (type: "pg_kompleks"). Wajib sertakan "complexStatements" berisi 4 poin pernyataan (1, 2, 3, 4) dan "options" kombinasi (A, B, C, D).
- Nomor ${totalPg + totalPgK + 1} s.d. ${totalPg + totalPgK + totalIsian}: Isian Singkat (type: "isian").
- Nomor ${totalPg + totalPgK + totalIsian + 1} s.d. ${totalQuestions}: Uraian / Esai (type: "esai").
4. KONTEN BAHASA ARAB / AGAMA: Sertakan "arabicText" (berharakat lengkap) dan "arabicTranslation" jika terkait PAI/Bahasa Arab.
5. BEBAS KOTAK: Jangan menggunakan kotak dekoratif.`;

    const userPrompt = `Mata Pelajaran: ${subjectName || 'Matematika'}
Fase: ${fase || 'Fase B'}
Tingkat Kelas: ${classLevel || 'Kelas 4'}
Target Butir Soal:
- Pilihan Ganda (PG): ${totalPg} butir
- PG Kompleks (MCMA): ${totalPgK} butir
- Isian Singkat: ${totalIsian} butir
- Uraian / Esai: ${totalEsai} butir
Total: ${totalQuestions} butir soal.

Preferensi Stimulus: ${stimulusTypePreference} (PASTIKAN menghadirkan variasi tabel data, gambar diagram/vektor SVG, dan teks narasi/cerita sesuai instruksi stimulus gabungan!).
${customStimulusTitle ? `Pengantar Stimulus Guru: "${customStimulusTitle}"` : ''}
${customStimulusText ? `Wacana Guru: "${customStimulusText}"` : ''}
${customStimulusTable ? `Tabel Data Guru: "${customStimulusTable}"` : ''}

Daftar CP & TP Referensi:
${cpSummary}

Keluarkan HANYA JSON array berisi ${totalQuestions} butir soal dengan properti persis sesuai petunjuk (questionText LENGKAP, options LENGKAP ber-label A/B/C/D, serta stimulusTable, stimulusSvg, stimulusText sesuai variasi).`;

    const candidateModels = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.8-flash"];
    let responseText = "[]";
    let lastError: any = null;

    for (const modelName of candidateModels) {
      try {
        console.log(`[AI Question Gen] Trying model: ${modelName}...`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents: userPrompt,
          config: {
            systemInstruction: systemInstruction,
            temperature: 0.3,
            responseMimeType: "application/json",
          }
        });

        if (response && response.text) {
          responseText = response.text;
          console.log(`[AI Question Gen] Success using ${modelName}`);
          break;
        }
      } catch (err: any) {
        console.warn(`[AI Question Gen] Model ${modelName} failed or unavailable:`, err?.message || err);
        lastError = err;
      }
    }

    if (responseText === "[]" && lastError) {
      throw new Error(`Server AI Google sedang mengalami lonjakan antrean tinggi (${lastError?.message || '503 Unavailable'}).`);
    }

    let questionsResult: any[] = [];
    try {
      const parsed = JSON.parse(responseText);
      questionsResult = Array.isArray(parsed) ? parsed : (parsed.questions || parsed.data || parsed.soal || []);
    } catch (parseErr) {
      console.warn("JSON parse fallback on generate-questions-ai...", parseErr);
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        questionsResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Gagal membaca struktur JSON dari AI.");
      }
    }

    // Helper: Normalize options to Array<{ label: 'A'|'B'|'C'|'D', text: string }>
    const normalizeOptions = (raw: any, count: number = 4): { label: 'A' | 'B' | 'C' | 'D'; text: string }[] => {
      const letters: ('A' | 'B' | 'C' | 'D')[] = ['A', 'B', 'C', 'D'];

      // 1. Array of { label, text }
      if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'object' && raw[0] !== null && 'text' in raw[0]) {
        return raw.slice(0, count).map((item, idx) => ({
          label: (item.label || letters[idx]) as 'A' | 'B' | 'C' | 'D',
          text: String(item.text || '').replace(/^[A-Da-d][\.\)]\s*/, '')
        }));
      }

      // 2. Array of strings (e.g. ["12 cm", "15 cm"] or ["A. 12 cm", "B. 15 cm"])
      if (Array.isArray(raw) && raw.length > 0) {
        return raw.slice(0, count).map((item, idx) => {
          let text = typeof item === 'string' ? item : (item?.text || item?.pilihan || JSON.stringify(item));
          text = String(text).replace(/^[A-Da-d][\.\)]\s*/, '').trim();
          return {
            label: letters[idx],
            text: text || `Pilihan ${letters[idx]}`
          };
        });
      }

      // 3. Object with keys { A: "...", B: "...", C: "...", D: "..." }
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const out: { label: 'A' | 'B' | 'C' | 'D'; text: string }[] = [];
        letters.slice(0, count).forEach(letter => {
          const val = raw[letter] || raw[letter.toLowerCase()] || raw[`pilihan_${letter.toLowerCase()}`] || raw[`opsi_${letter.toLowerCase()}`];
          if (val !== undefined) {
            let clean = String(val).replace(/^[A-Da-d][\.\)]\s*/, '').trim();
            out.push({ label: letter, text: clean });
          }
        });
        if (out.length > 0) return out;
      }

      // 4. Default fallback
      return letters.slice(0, count).map(l => ({
        label: l,
        text: `Pilihan ${l}`
      }));
    };

    // Library of fallback educational tables & SVG presets for enrichment when AI only provides text
    const mathSvgs = ['math_bar_chart', 'math_fraction_3_4', 'math_triangle_right', 'math_rectangle', 'math_cuboid_3d', 'math_clock_0715', 'math_fraction_2_5'];
    const fallbackTables = [
      {
        title: 'Tabel Rekapitulasi Data dan Informasi Pengamatan',
        table: 'No | Kategori / Aspek | Kuantitas / Hasil | Status Ketercapaian\n1 | Lingkup Aspek A | 45 unit | Memenuhi Standar\n2 | Lingkup Aspek B | 60 unit | Sangat Baik\n3 | Lingkup Aspek C | 30 unit | Perlu Peningkatan',
      },
      {
        title: 'Tabel Daftar Belanjaan dan Harga Barang Koperasi Madrasah',
        table: 'Nama Barang | Harga Satuan | Jumlah Beli\nBuku Tulis Isi 38 | Rp4.000,00 | 5 buah\nPensil 2B | Rp2.500,00 | 4 buah\nPenghapus Karet | Rp1.500,00 | 2 buah\nPenggaris 30 cm | Rp3.000,00 | 1 buah',
      },
      {
        title: 'Tabel Distribusi Nilai Ulangan Siswa',
        table: 'Rentang Nilai | Banyak Siswa (Frekuensi)\n70 | 4 siswa\n80 | 10 siswa\n90 | 8 siswa\n100 | 3 siswa',
      },
      {
        title: 'Tabel Perbandingan Sifat dan Karakteristik Materi Pokok',
        table: 'No | Nama Objek / Materi | Ciri Utama | Penerapan Nyata\n1 | Unsur Pertama | Teratur dan sistematis | Pembiasaan di Madrasah\n2 | Unsur Kedua | Bernalar kritis | Pemecahan Masalah Nyata\n3 | Unsur Ketiga | Saling melengkapi | Kerjasama Kolaboratif',
      }
    ];

    // Format & validate each item to match QuestionItem interface
    const formattedQuestions = questionsResult.map((q: any, idx: number) => {
      const num = q.number || q.nomor || (idx + 1);
      const qType = q.type || q.jenis || (num <= totalPg ? 'pg' : num <= totalPg + totalPgK ? 'pg_kompleks' : num <= totalPg + totalPgK + totalIsian ? 'isian' : 'esai');
      
      const cpIndex = idx % cpList.length;
      const targetCP = cpList[cpIndex] || cpList[0] || {};
      const targetTP = targetCP.tpList?.[idx % (targetCP.tpList?.length || 1)] || targetCP.tpList?.[0];
      const effectiveMateri = q.materiPokok || q.materi || targetTP?.materiPokok || targetCP.materiPokok || subjectName || 'Materi Pokok';

      // Robust question text extraction
      let rawQText = q.questionText || q.pertanyaan || q.soal || q.stem || q.teks_soal || q.soal_teks || q.text || q.tanya || '';
      rawQText = String(rawQText).trim();

      // Ensure question text is NEVER a generic placeholder like "Pertanyaan nomor X"
      if (!rawQText || /^pertanyaan\s*(nomor\s*)?\d+$/i.test(rawQText)) {
        if (qType === 'pg') {
          rawQText = `Berdasarkan konsep materi ${effectiveMateri}, jawaban yang paling tepat untuk melengkapi pernyataan tersebut adalah ...`;
        } else if (qType === 'pg_kompleks') {
          rawQText = `Perhatikan beberapa pernyataan terkait materi ${effectiveMateri} di bawah ini!\nBerdasarkan daftar pernyataan di atas, manakah pernyataan yang BENAR?`;
        } else if (qType === 'isian') {
          rawQText = `Konsep atau istilah penting dalam pembahasan ${effectiveMateri} yang menjelaskan kaidah tersebut adalah ...`;
        } else {
          rawQText = `Jelaskan secara lengkap konsep ${effectiveMateri} dan berikan contoh penerapannya dalam kehidupan sehari-hari!`;
        }
      }

      // Robust options extraction
      let options = undefined;
      if (qType === 'pg' || qType === 'pg_kompleks') {
        const rawOpts = q.options || q.pilihan_jawaban || q.pilihan || q.opsi || q.choices;
        options = normalizeOptions(rawOpts, optionsCount);
      }

      // Robust complexStatements extraction for PG Kompleks (Prevents [object Object] bug)
      let complexStatements = undefined;
      if (qType === 'pg_kompleks') {
        const rawStatements = q.complexStatements || q.pernyataan || q.daftar_pernyataan || q.statements;
        if (Array.isArray(rawStatements) && rawStatements.length > 0) {
          complexStatements = rawStatements.map((s: any, sIdx: number) => {
            let str = '';
            if (typeof s === 'string') {
              str = s;
            } else if (typeof s === 'object' && s !== null) {
              str = s.text || s.statement || s.pernyataan || s.isi || s.deskripsi || s.content || s.value || '';
              if (!str) {
                const found = Object.values(s).find(v => typeof v === 'string' && !v.includes('[object Object]'));
                if (found) str = found as string;
              }
            } else if (s !== undefined && s !== null) {
              str = String(s);
            }

            // Clean string of [object Object] and leading numbers (1. / (1) / 1) )
            str = str.replace(/\[object Object\]/g, '').replace(/^[\(\[]?\d+[\)\]\.\:\s]+/, '').trim();

            if (!str) {
              if (sIdx === 0) str = `Memahami konsep dan kaidah utama materi ${effectiveMateri} dengan tepat.`;
              else if (sIdx === 1) str = `Menerapkan kaidah dan langkah penyelesaian pada pembahasan ${effectiveMateri}.`;
              else if (sIdx === 2) str = `Mengabaikan ketentuan umum yang berlaku pada pokok bahasan.`;
              else str = `Menyelesaikan permasalahan kontekstual secara runtut dan mandiri.`;
            }
            return str;
          });
        } else {
          complexStatements = [
            `Memahami konsep dan kaidah utama materi ${effectiveMateri} dengan tepat.`,
            `Menerapkan kaidah dan langkah penyelesaian pada pembahasan ${effectiveMateri}.`,
            `Mengabaikan ketentuan umum yang berlaku pada pokok bahasan.`,
            `Menyelesaikan permasalahan kontekstual secara runtut dan mandiri.`
          ];
        }
      }

      // Robust correctAnswer extraction
      let correct = q.correctAnswer || q.kunci_jawaban || q.kunci || q.jawaban || q.jawaban_benar || 'A';
      if (typeof correct === 'string' && (qType === 'pg' || qType === 'pg_kompleks')) {
        const match = correct.match(/\b([A-D])\b/i);
        if (match) {
          correct = match[1].toUpperCase();
        }
      }

      // Extract raw stimulus from AI
      let rawTitle = q.stimulusTitle || q.judul_stimulus || undefined;
      let rawText = q.stimulusText || q.stimulus || q.bacaan || q.teks_stimulus || undefined;
      let rawTable = q.stimulusTable || q.tabel || q.data_tabel || undefined;
      let rawSvg = q.stimulusSvg || q.svg || q.diagram || q.gambar_svg || q.gambar || undefined;
      let rawImg = q.stimulusImageUrl || q.imageUrl || undefined;

      // Clean string representation of table if array of objects returned
      if (Array.isArray(rawTable) && rawTable.length > 0) {
        try {
          const keys = Object.keys(rawTable[0]);
          const headerLine = keys.join(' | ');
          const rowsLines = rawTable.map((r: any) => keys.map(k => String(r[k] || '')).join(' | '));
          rawTable = [headerLine, ...rowsLines].join('\n');
        } catch {
          rawTable = undefined;
        }
      }

      // ENRICHMENT: If user selected 'gabungan' / 'campuran', ensure real tables and real diagrams are present!
      if (isStimulusGabungan) {
        const cycle = idx % 4;
        if (cycle === 1 && !rawTable) {
          // Provide structured markdown table
          const tab = fallbackTables[idx % fallbackTables.length];
          rawTable = tab.table;
          if (!rawTitle) rawTitle = `Data Pengamatan: ${effectiveMateri}`;
        } else if (cycle === 2 && !rawSvg && !rawImg) {
          // Provide visual diagram/SVG
          const isAgama = /akidah|fiqih|fikih|qur|hadis|ski|arab|islam/i.test(subjectName || '');
          if (isAgama) {
            const agamaSvgs = ['agama_wudhu_steps', 'agama_mizan_scale', 'agama_kiblat_kaaba'];
            rawSvg = agamaSvgs[idx % agamaSvgs.length];
            if (!rawTitle) rawTitle = `Ilustrasi Materi ${effectiveMateri}`;
          } else {
            rawSvg = mathSvgs[idx % mathSvgs.length];
            if (!rawTitle) rawTitle = `Diagram Visual: ${effectiveMateri}`;
          }
        } else if (cycle === 3) {
          // Complete combined stimulus (Text + Table or Text + Diagram)
          if (!rawText) {
            rawText = `Berikut adalah data dan informasi terpadu terkait materi ${effectiveMateri}. Cermatilah dengan teliti sebelum menjawab pertanyaan.`;
          }
          if (!rawTable) {
            const tab = fallbackTables[(idx + 1) % fallbackTables.length];
            rawTable = tab.table;
          }
          if (!rawTitle) rawTitle = `Informasi Terpadu: ${effectiveMateri}`;
        }
      } else if (isStimulusTabel && !rawTable) {
        const tab = fallbackTables[idx % fallbackTables.length];
        rawTable = tab.table;
        if (!rawTitle) rawTitle = tab.title;
      } else if (isStimulusGambar && !rawSvg && !rawImg) {
        rawSvg = mathSvgs[idx % mathSvgs.length];
        if (!rawTitle) rawTitle = `Diagram Visual: ${effectiveMateri}`;
      }

      // Accurate stimulusType calculation
      const hasT = !!rawText && String(rawText).trim().length > 0;
      const hasTab = !!rawTable && String(rawTable).trim().length > 0;
      const hasG = !!rawSvg || !!rawImg;

      let calculatedType: string = 'none';
      if ((hasT && (hasTab || hasG)) || (hasTab && hasG) || (isStimulusGabungan && (hasTab || hasG || hasT))) {
        calculatedType = (hasTab && hasG) || (hasT && (hasTab || hasG)) ? 'gabungan' : hasTab ? 'tabel' : hasG ? 'gambar' : 'cerita';
      } else if (hasTab) {
        calculatedType = 'tabel';
      } else if (hasG) {
        calculatedType = 'gambar';
      } else if (hasT) {
        calculatedType = 'cerita';
      }

      return {
        id: `ai-gen-${idx + 1}-${Date.now()}`,
        number: num,
        type: qType,
        subType: qType === 'pg_kompleks' ? 'mcma' : 'tunggal',
        stimulusType: (q.stimulusType && q.stimulusType !== 'none') ? q.stimulusType : calculatedType,
        stimulusTitle: rawTitle,
        stimulusText: rawText,
        stimulusTable: rawTable,
        stimulusSvg: rawSvg,
        stimulusImageUrl: rawImg,
        questionText: rawQText,
        options: options,
        complexStatements: complexStatements,
        correctAnswer: correct,
        score: q.score || (qType === 'pg' ? (bobot.pg || 2) : qType === 'pg_kompleks' ? (bobot.pgKompleks || 4) : qType === 'isian' ? (bobot.isian || 4) : (bobot.esai || 6)),
        cognitiveLevel: q.cognitiveLevel || q.level_kognitif || (num % 3 === 0 ? 'L3' : num % 2 === 0 ? 'L2' : 'L1'),
        indikatorSoal: q.indikatorSoal || q.indikator || `Peserta didik dapat menyelesaikan soal terkait materi ${effectiveMateri}.`,
        ipk: q.ipk || `Menguasai kompetensi materi ${effectiveMateri}.`,
        classLevel: classLevel || 'Kelas 4',
        materiPokok: effectiveMateri,
        capaianPembelajaran: targetCP.capaianPembelajaran || cpList[0]?.capaianPembelajaran || '',
        cpId: targetCP.id || cpList[0]?.id,
        cpCode: targetCP.code || cpList[0]?.code,
        tpId: targetTP?.id || cpList[0]?.tpList?.[0]?.id,
        tpCode: targetTP?.code || cpList[0]?.tpList?.[0]?.code,
        tujuanPembelajaran: targetTP?.text || cpList[0]?.tpList?.[0]?.text,
        rubrikPenilaian: q.rubrikPenilaian || q.rubrik || q.pembahasan || `Kunci jawaban benar bernilai skor penuh.`,
        arabicText: q.arabicText || undefined,
        arabicTranslation: q.arabicTranslation || undefined,
        kbcPillar: q.kbcPillar || 'Cinta Ilmu',
        kbcDescription: q.kbcDescription || undefined
      };
    });

    res.json({
      success: true,
      questions: formattedQuestions
    });
  } catch (error: any) {
    console.error("Generate questions AI error:", error);
    res.status(500).json({ error: error.message || "Gagal membuat soal via Gemini AI." });
  }
});

// Setup Vite Dev Server / Static Asset delivery
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in DEVELOPMENT mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in PRODUCTION mode...");
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
