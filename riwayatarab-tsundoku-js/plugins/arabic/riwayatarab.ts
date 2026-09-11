import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { load as loadCheerio } from 'cheerio';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

const BASE = 'https://riwayatarab.com';

function absUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, BASE).toString();
  } catch {
    return undefined;
  }
}

function cleanPath(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const u = new URL(value, BASE);
    return u.pathname + (u.search || '');
  } catch {
    return value.startsWith('/') ? value : `/${value}`;
  }
}

function textAfterLabel($: any, label: string): string {
  const body = $('body').text().replace(/\s+/g, ' ').trim();
  const i = body.indexOf(label);
  if (i < 0) return '';
  return body.slice(i + label.length, i + label.length + 120)
    .split(/(?:\d+(?:\.\d+)?[كك]?\s*مشاهدة|فصل|آخر تحديث|نبذة)/)[0]
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNovelLinks($: any): Plugin.NovelItem[] {
  const out: Plugin.NovelItem[] = [];
  const seen = new Set<string>();

  $('a[href]').each((_: number, el: any) => {
    const href = $(el).attr('href');
    const path = cleanPath(href);
    if (!path) return;

    // Only /novel/<slug>; exclude /chapter and /chapters.
    if (!/^\/novel\/[^/?#]+\/?$/.test(path)) return;

    const name = $(el).text().replace(/\s+/g, ' ').trim();
    if (!name || name.length < 2) return;
    if (seen.has(path)) return;

    const img = $(el).find('img').first();
    const cover = absUrl(img.attr('src') || img.attr('data-src'));

    seen.add(path);
    out.push({
      id: undefined,
      name,
      path,
      cover: cover || defaultCover,
    });
  });

  return out;
}

function parseChapterLinks($: any): Plugin.ChapterItem[] {
  const out: Plugin.ChapterItem[] = [];
  const seen = new Set<string>();

  $('a[href]').each((_: number, el: any) => {
    const href = $(el).attr('href');
    const path = cleanPath(href);
    if (!path) return;

    const m = path.match(/^\/novel\/([^/]+)\/chapter\/(\d+)\/?$/);
    if (!m || seen.has(path)) return;

    const chapterNumber = Number(m[2]);
    const rawName = $(el).text().replace(/\s+/g, ' ').trim();
    const name = rawName || `الفصل ${chapterNumber}`;

    seen.add(path);
    out.push({
      name,
      path,
      releaseTime: '',
      chapterNumber,
      page: '',
    });
  });

  // Site lists chapters in ascending order on the novel/chapters pages.
  out.sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0));
  return out;
}

class Riwayatarab implements Plugin.PluginBase {
  id = 'riwayatarab';
  name = 'Riwayatarab';
  icon = 'src/ar/riwayatarab/icon.svg';
  site = BASE;
  version = '1.0.0';

  async popularNovels(
    pageNo: number,
    { showLatestNovels }: Plugin.PopularNovelsOptions,
  ): Promise<Plugin.NovelItem[]> {
    const url = showLatestNovels
      ? `${BASE}/latest${pageNo > 1 ? `?page=${pageNo}` : ''}`
      : `${BASE}/${pageNo > 1 ? `?page=${pageNo}` : ''}`;

    const res = await fetchApi(url);
    if (!res.ok) throw new Error(`Riwayatarab: HTTP ${res.status}`);
    const $ = loadCheerio(await res.text());
    return parseNovelLinks($);
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    // Riwayatarab's search UI is client-side, and the exact query parameter
    // may change. Try the common query names and accept the first response
    // that contains novel links.
    const candidates = [
      `${BASE}/search?q=${encodeURIComponent(searchTerm)}${pageNo > 1 ? `&page=${pageNo}` : ''}`,
      `${BASE}/search?query=${encodeURIComponent(searchTerm)}${pageNo > 1 ? `&page=${pageNo}` : ''}`,
      `${BASE}/search?search=${encodeURIComponent(searchTerm)}${pageNo > 1 ? `&page=${pageNo}` : ''}`,
    ];

    for (const url of candidates) {
      const res = await fetchApi(url);
      if (!res.ok) continue;
      const $ = loadCheerio(await res.text());
      const novels = parseNovelLinks($);
      if (novels.length) return novels;
    }

    return [];
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const res = await fetchApi(BASE + novelPath);
    if (!res.ok) throw new Error(`Riwayatarab: HTTP ${res.status}`);
    const $ = loadCheerio(await res.text());

    const name =
      $('h1').first().text().replace(/\s+/g, ' ').trim() ||
      $('title').text().split('-')[0].trim() ||
      'بدون عنوان';

    const image = $('img[alt]').filter((_, el) => {
      const alt = $(el).attr('alt')?.trim();
      return !!alt && alt === name;
    }).first();

    const cover = absUrl(
      image.attr('src') ||
      image.attr('data-src') ||
      $('main img').first().attr('src') ||
      $('img').first().attr('src'),
    ) || defaultCover;

    const authorText = textAfterLabel($, 'بقلم:');
    const summaryHeading = $('h2').filter((_, el) =>
      $(el).text().replace(/\s+/g, ' ').includes('نبذة عن الرواية')
    ).first();

    let summary = '';
    if (summaryHeading.length) {
      const parts: string[] = [];
      let node = summaryHeading.next();
      for (let i = 0; i < 5 && node.length; i++) {
        const t = node.text().replace(/\s+/g, ' ').trim();
        if (t && !/قائمة الفصول/.test(t)) parts.push(t);
        node = node.next();
      }
      summary = parts.join('\n');
    }

    const bodyText = $('body').text().replace(/\s+/g, ' ');
    const status = bodyText.includes('مستمرة')
      ? NovelStatus.Ongoing
      : bodyText.includes('مكتملة')
        ? NovelStatus.Completed
        : NovelStatus.Unknown;

    // The novel page exposes the first chapter page. Remaining pages are
    // available from /chapters?page=N.
    const chapterPath = `${novelPath.replace(/\/$/, '')}/chapters`;
    const chapterRes = await fetchApi(BASE + chapterPath);
    let chapters: Plugin.ChapterItem[] = [];
    let totalPages = 1;

    if (chapterRes.ok) {
      const chapterHtml = await chapterRes.text();
      const $chapters = loadCheerio(chapterHtml);
      chapters = parseChapterLinks($chapters);

      let maxPage = 1;
      $chapters('a[href]').each((_: number, el: any) => {
        const href = $(el).attr('href') || '';
        const m = href.match(/[?&]page=(\d+)/);
        if (m) maxPage = Math.max(maxPage, Number(m[1]));
      });

      const pageText = $chapters('body').text().match(/الصفحة\s+\d+\s+من\s+(\d+)/);
      if (pageText) maxPage = Math.max(maxPage, Number(pageText[1]));
      totalPages = maxPage;
    }

    const novel: Plugin.SourceNovel = {
      id: undefined,
      path: novelPath,
      name,
      author: authorText || 'غير محدد',
      artist: '',
      cover,
      genres: '',
      status,
      summary,
      chapters,
      totalPages: totalPages > 1 ? totalPages : undefined,
    };

    return novel;
  }

  async parsePage(
    novelPath: string,
    page: string,
  ): Promise<Plugin.SourcePage> {
    const p = Math.max(1, Number(page) || 1);
    const url = `${BASE}${novelPath.replace(/\/$/, '')}/chapters?page=${p}`;
    const res = await fetchApi(url);
    if (!res.ok) throw new Error(`Riwayatarab: HTTP ${res.status}`);
    const $ = loadCheerio(await res.text());
    return { chapters: parseChapterLinks($) };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const res = await fetchApi(BASE + chapterPath);
    if (!res.ok) throw new Error(`Riwayatarab: HTTP ${res.status}`);
    const $ = loadCheerio(await res.text());

    // Prefer semantic/content containers. The fallback walks the page's
    // paragraphs after the chapter heading and before the footer navigation.
    const selectors = [
      '.chapter-content',
      '.chapter-body',
      '.reading-content',
      '.formatted-content',
      'article',
      'main',
    ];

    for (const selector of selectors) {
      const el = $(selector).first();
      if (el.length && el.text().trim().length > 200) {
        el.find('script,style,noscript,nav,footer,.ads,.ad').remove();
        return el.html() || '';
      }
    }

    const heading = $('h1').filter((_, el) =>
      /الفصل\s+\d+/.test($(el).text())
    ).first();

    if (heading.length) {
      const parts: string[] = [];
      let node = heading.next();
      for (let i = 0; i < 1000 && node.length; i++) {
        const t = node.text().replace(/\s+/g, ' ').trim();
        if (t === 'الفصل السابق' || t === 'الفصل التالي') break;
        if (t && !/عرض قائمة الفصول الكاملة/.test(t)) {
          const html = node.html();
          if (html) parts.push(html);
        }
        node = node.next();
      }
      if (parts.length) return parts.join('\n');
    }

    throw new Error('Riwayatarab: لم يتم العثور على محتوى الفصل.');
  }

  resolveUrl = (path: string) => BASE + path;
}

export default new Riwayatarab();
