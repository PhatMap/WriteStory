import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from "@google/genai";
import {
  markGeminiKeyFailure,
  markGeminiKeyQuotaExceeded,
  markGeminiKeyUsed,
  selectGeminiKey,
} from "../utils/geminiKeys";

type GeminiKeySelection = {
  id?: string;
  label: string;
  apiKey: string;
  source: "local" | "env";
};

const STABLE_FLASH_MODEL = "gemini-2.5-flash";
const STABLE_FLASH_LITE_MODEL = "gemini-2.5-flash-lite";
const STABLE_IMAGE_MODEL = "gemini-2.5-flash-image";

const LEGACY_MODEL_ALIASES: Record<string, string> = {
  "gemini-3.1-flash-preview": STABLE_FLASH_MODEL,
  "gemini-3.1-flash-lite-preview": STABLE_FLASH_LITE_MODEL,
  "gemini-flash-latest": STABLE_FLASH_MODEL,
  "gemini-flash-lite-latest": STABLE_FLASH_LITE_MODEL,
};

const QUOTA_ERROR_PATTERNS = [
  "quota",
  "resource_exhausted",
  "429",
  "rate limit",
  "too many requests",
  "exceeded your current quota",
];

const MODEL_ERROR_PATTERNS = [
  "model not found",
  "unsupported model",
  "invalid model",
  "unknown model",
  "not found for api version",
];

const KEY_ROTATION_ERROR_PATTERNS = [
  ...QUOTA_ERROR_PATTERNS,
  "api key not valid",
  "invalid api key",
  "unauthenticated",
  "permission denied",
  "forbidden",
];

function hasErrorPattern(errorMessage: string, patterns: string[]) {
  const normalizedMessage = errorMessage.toLowerCase();
  return patterns.some((pattern) => normalizedMessage.includes(pattern));
}

function isModelError(errorMessage: string) {
  return hasErrorPattern(errorMessage, MODEL_ERROR_PATTERNS);
}

function isQuotaError(errorMessage: string) {
  return !isModelError(errorMessage) && hasErrorPattern(errorMessage, QUOTA_ERROR_PATTERNS);
}

function shouldRotateGeminiKey(errorMessage: string) {
  return !isModelError(errorMessage) && hasErrorPattern(errorMessage, KEY_ROTATION_ERROR_PATTERNS);
}

function getEnvGeminiApiKey() {
  if (typeof process === "undefined") return undefined;
  const envKey = process.env.GEMINI_API_KEY;
  return typeof envKey === "string" && envKey.trim()
    ? envKey.trim()
    : undefined;
}

function getAI(apiKey: string) {
  return new GoogleGenAI({ apiKey });
}

function normalizeGeminiModelName(model?: string) {
  if (!model) return STABLE_FLASH_MODEL;
  return LEGACY_MODEL_ALIASES[model] ?? model;
}

async function getSelectedGeminiKey(
  excludedIds: string[] = [],
): Promise<GeminiKeySelection | null> {
  const localKey = await selectGeminiKey(excludedIds);
  if (localKey) {
    return {
      id: localKey.id,
      label: localKey.label,
      apiKey: localKey.apiKey,
      source: "local",
    };
  }

  const envKey = getEnvGeminiApiKey();
  if (envKey) {
    return {
      label: "ENV",
      apiKey: envKey,
      source: "env",
    };
  }

  return null;
}

async function safeGenerateContent(
  params: any,
  retryCount = 0,
  exhaustedKeyIds: string[] = [],
): Promise<any> {
  const normalizedParams = {
    ...params,
    model: normalizeGeminiModelName(params.model),
  };

  // Always use the most relaxed safety settings to remove limits
  const relaxedSafetySettings = [
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_HARASSMENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
  ];

  if (!normalizedParams.config) normalizedParams.config = {};
  normalizedParams.config.safetySettings = relaxedSafetySettings;

  const selectedKey = await getSelectedGeminiKey(exhaustedKeyIds);
  if (!selectedKey) {
    throw new Error(
      exhaustedKeyIds.length > 0
        ? "Tất cả Gemini API key hiện đang hết lượt hoặc tạm thời không khả dụng. Hãy kiểm tra lại trong Cài đặt."
        : "Chưa có Gemini API key nào được cấu hình. Hãy thêm key trong tab Tham khảo.",
    );
  }

  try {
    const ai = getAI(selectedKey.apiKey);
    const response = await ai.models.generateContent(normalizedParams);

    if (selectedKey.source === "local" && selectedKey.id) {
      await markGeminiKeyUsed(selectedKey.id);
    }

    return response;
  } catch (error: any) {
    const errorMessage = error.message || String(error);

    if (
      selectedKey.source === "local" &&
      selectedKey.id &&
      shouldRotateGeminiKey(errorMessage)
    ) {
      if (isQuotaError(errorMessage)) {
        await markGeminiKeyQuotaExceeded(selectedKey.id, errorMessage);
      } else {
        await markGeminiKeyFailure(selectedKey.id, errorMessage);
      }

      return safeGenerateContent(normalizedParams, retryCount, [
        ...exhaustedKeyIds,
        selectedKey.id,
      ]);
    }

    if (isQuotaError(errorMessage)) {
      throw new Error(
        "Quota exceeded. Bạn đã hết lượt sử dụng AI hôm nay. Vui lòng thử lại vào ngày mai.",
      );
    }

    if (isModelError(errorMessage)) {
      throw new Error(
        `Model AI hiện không khả dụng: ${normalizedParams.model}. App đã tự chuyển các model cũ sang bản ổn định, nhưng model này vẫn không chạy được với key hiện tại.`,
      );
    }

    if (selectedKey.source === "local" && selectedKey.id) {
      await markGeminiKeyFailure(selectedKey.id, errorMessage);
    }

    // Auto-fix: Retry with fallback strategies if not a quota error
    if (retryCount < 3) {
      console.warn(
        `AI generation failed (attempt ${retryCount + 1}). Auto-fixing and retrying...`,
        error,
      );

      const fallbackParams = { ...normalizedParams };

      // Strategy 1: Relax safety settings completely if it was a safety block
      if (errorMessage.toLowerCase().includes("safety")) {
        fallbackParams.config = {
          ...fallbackParams.config,
          safetySettings: [
            {
              category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_HARASSMENT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
            {
              category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
              threshold: HarmBlockThreshold.BLOCK_NONE,
            },
          ],
        };
      }
      // Strategy 2: If it's an RPC/XHR error, wait longer and try a different model
      else if (
        errorMessage.toLowerCase().includes("rpc") ||
        errorMessage.toLowerCase().includes("xhr")
      ) {
        console.log(
          "Detected RPC/XHR error, switching to a more stable model for retry...",
        );
        // Only switch models if it's not an image generation model
        if (!normalizedParams.model?.includes("image")) {
          fallbackParams.model =
            retryCount === 0 ? STABLE_FLASH_MODEL : STABLE_FLASH_LITE_MODEL;
        }
      }
      // Strategy 3: Switch to a faster but still capable model if it was a timeout or internal error
      else if (retryCount >= 1) {
        // Only switch models if it's not an image generation model
        if (!normalizedParams.model?.includes("image")) {
          fallbackParams.model = STABLE_FLASH_MODEL;
        }
      }

      // Wait a bit before retrying (exponential backoff)
      const waitTime = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return safeGenerateContent(
        fallbackParams,
        retryCount + 1,
        exhaustedKeyIds,
      );
    }

    if (isModelError(errorMessage)) {
      throw new Error(
        `Model AI hiện không khả dụng: ${normalizedParams.model}. Hãy dùng model ổn định hơn hoặc thử lại sau.`,
      );
    }

    throw new Error(
      `Lỗi AI: ${errorMessage}. Hệ thống đã cố gắng tự động khắc phục nhưng không thành công.`,
    );
  }
}

const HAN_VIET_RULES = `
VĂN PHONG HÁN VIỆT (CONVERT SANGTACVIET STYLE):
1. GIỮ NGUYÊN TỪ HÁN VIỆT: Tuyệt đối không "thuần Việt hóa" các từ ngữ đặc trưng. Sử dụng: 'ngươi', 'hắn', 'không gian', 'cường giả', 'khủng bố', 'vạn phần', 'thâm thúy', 'phù dung xuất thủy', 'lãnh nhãn bàng quan', 'lãnh mang', 'tinh sảo', 'bàng bạc'...
2. CẤU TRÚC CÂU TRUNG QUỐC: Giữ nguyên cấu trúc câu đặc trưng của tiếng Trung (Ví dụ: 'Hắn ánh mắt bên trong lóe lên một tia lãnh mang' thay vì 'Trong mắt hắn lóe lên tia nhìn lạnh lẽo').
3. TÍNH TỪ GHÉP & THÀNH NGỮ 4 CHỮ: Sử dụng dày đặc các cụm từ 4 chữ hoặc từ ghép Hán Việt để miêu tả (ví dụ: 'khí thế bàng bạc', 'ngũ quan tinh sảo', 'thân hình bốc lửa', 'phong thái hiên ngang', 'uy áp kinh người').
4. DANH TỪ RIÊNG & THUẬT NGỮ: Giữ nguyên các danh hiệu, tên chiêu thức, cấp độ, địa danh (ví dụ: Thần vực, Thức tỉnh nghi thức, Tinh Nguyên thành, Trúc Cơ kỳ, Thiên tài địa bảo).
5. SẮC THÁI MIÊU TẢ NỮ NHÂN: Sử dụng các từ ngữ gợi hình, Hán Việt để miêu tả vẻ đẹp và cơ thể nữ giới (ví dụ: 'cự nhũ', 'phập phồng', 'tuyết bạch', 'mị hoặc', 'ngọc thủ', 'tiêm eo', 'phong mãn').
6. HÀNH VĂN: Súc tích, trang trọng, mang đậm màu sắc tiên hiệp/huyền huyễn Trung Quốc.
`;

const THUAN_VIET_RULES = `
VĂN PHONG THUẦN VIỆT (HIỆN ĐẠI/DÂN GIAN):
1. Sử dụng từ ngữ thuần Việt, gần gũi, giàu hình ảnh.
2. Câu văn trôi chảy, giàu cảm xúc. Miêu tả chi tiết về tâm lý nhân vật và môi trường xung quanh một cách sinh động.
3. KHÔNG lạm dụng từ Hán Việt quá đà, giữ sự tự nhiên trong giao tiếp.
`;

const NSFW_RULES = `
18+ & NSFW (CẢNH NÓNG):
1. CHỈ THÊM CẢNH NÓNG KHI THỰC SỰ CẦN THIẾT cho mạch truyện hoặc khi có chỉ thị cụ thể. TUYỆT ĐỐI KHÔNG thêm cảnh sắc "vô tội vạ" nếu bối cảnh không yêu cầu.
2. Miêu tả trực diện, trần trụi nhưng phải TUYỆT ĐỐI PHÙ HỢP với diễn biến tình cảm.
3. Tập trung vào cảm giác, phản ứng cơ thể và sự thăng hoa cảm xúc.
4. Đảm bảo sự đồng thuận và logic trong hành vi của các nhân vật.
`;

export async function generateStoryIdeas(params: {
  genres: string[];
  worldSetting: string;
  resources: string;
  races: string;
  powerSystem: string;
  worldLogic: string;
  prompt: string;
  learningContext?: string;
}) {
  const {
    genres,
    worldSetting,
    resources,
    races,
    powerSystem,
    worldLogic,
    prompt,
    learningContext,
  } = params;

  let contents = `Bạn là một chuyên gia sáng tạo nội dung truyện. Hãy tạo ra 3 ý tưởng cốt truyện ngắn gọn, hấp dẫn dựa trên các thông tin sau:
- Từ khóa/Ý tưởng chính: ${prompt || "Không có"}
- Thể loại: ${genres.length > 0 ? genres.join(", ") : "Không có"}
- Thiết lập thế giới: ${worldSetting || "Không có"}
- Tài nguyên: ${resources || "Không có"}
- Chủng tộc: ${races || "Không có"}
- Hệ thống sức mạnh: ${powerSystem || "Không có"}
- Logic vận hành thế giới: ${worldLogic || "Không có"}

LƯU Ý QUAN TRỌNG: 
1. TUYỆT ĐỐI KHÔNG sử dụng ngoặc đơn () để giải thích hoặc chú thích thêm. 
2. KHÔNG sử dụng ngoặc kép "" trừ khi thực sự cần thiết. 
3. Ẩn toàn bộ các từ ngữ mang tính chất chú thích thường nằm trong ngoặc.`;

  if (learningContext) {
    contents += `\n\nTHÔNG TIN HỌC TẬP TỪ TÀI LIỆU (Hãy tham khảo phong cách, bối cảnh hoặc ý tưởng từ đây):\n---\n${learningContext}\n---`;
  }

  contents += `\n\nHãy trình bày rõ ràng, súc tích và sáng tạo.`;

  const response = await safeGenerateContent({
    model: STABLE_FLASH_LITE_MODEL,
    contents,
  });
  return response.text;
}

export async function developCharacter(params: {
  characterName: string;
  identity: string;
  personality: string;
  appearance: string;
  talent: string;
  background: string;
  cheat: string;
  prompt: string;
  writingStyles?: string[];
}) {
  const {
    characterName,
    identity,
    personality,
    appearance,
    talent,
    background,
    cheat,
    prompt,
    writingStyles,
  } = params;
  const isHanViet = writingStyles?.includes("Hán Việt");

  let styleInstructions = "";
  if (isHanViet) styleInstructions = HAN_VIET_RULES;

  let contents = `Bạn là một nhà văn giàu kinh nghiệm. Hãy xây dựng một hồ sơ nhân vật chi tiết dựa trên các thông tin sau:
- Tên nhân vật chính: ${characterName || "Chưa xác định"}
- Mô tả ngắn/Ý tưởng chung: ${prompt || "Không có"}
- Danh tính: ${identity || "Không có"}
- Tính cách: ${personality || "Không có"}
- Ngoại hình: ${appearance || "Không có"}
- Thiên phú: ${talent || "Không có"}
- Gia cảnh: ${background || "Không có"}
- Kim thủ chỉ: ${cheat || "Không có"}

${styleInstructions ? `LƯU Ý VỀ VĂN PHONG:\n${styleInstructions}\n` : ""}

LƯU Ý QUAN TRỌNG: 
1. TUYỆT ĐỐI KHÔNG sử dụng ngoặc đơn () để giải thích hoặc chú thích thêm. 
2. KHÔNG sử dụng ngoặc kép "" trừ khi đó là lời thoại hoặc tên chiêu thức đặc biệt. 
3. Ẩn toàn bộ các từ ngữ mang tính chất chú thích thường nằm trong ngoặc.

Hãy trình bày hồ sơ nhân vật một cách sinh động, có chiều sâu, bao gồm cả động lực và bối cảnh phức tạp.`;

  const response = await safeGenerateContent({
    model: STABLE_FLASH_MODEL,
    contents,
  });
  return response.text;
}

export async function suggestCharacterNames(params: {
  identity: string;
  personality: string;
  background: string;
  worldSetting?: string;
  writingStyles?: string[];
}) {
  const { identity, personality, background, worldSetting, writingStyles } =
    params;
  const isHanViet = writingStyles?.includes("Hán Việt");

  let styleInstructions = "";
  if (isHanViet) styleInstructions = HAN_VIET_RULES;

  const contents = `Bạn là một chuyên gia đặt tên nhân vật cho tiểu thuyết. Hãy gợi ý 10 cái tên hay, ý nghĩa và phù hợp với bối cảnh dựa trên các thông tin sau:
- Danh tính: ${identity || "Chưa rõ"}
- Tính cách: ${personality || "Chưa rõ"}
- Gia cảnh: ${background || "Chưa rõ"}
${worldSetting ? `- Bối cảnh thế giới: ${worldSetting}` : ""}

${styleInstructions ? `LƯU Ý VỀ VĂN PHONG:\n${styleInstructions}\n` : ""}

YÊU CẦU:
1. Gợi ý 10 tên.
2. Mỗi tên đi kèm một giải thích ngắn gọn về ý nghĩa hoặc lý do tại sao nó phù hợp.
3. Trình bày dưới dạng danh sách rõ ràng.
4. TUYỆT ĐỐI KHÔNG dùng ngoặc đơn ().
5. Trả về trực tiếp danh sách, không thêm lời dẫn giải.`;

  const response = await safeGenerateContent({
    model: STABLE_FLASH_LITE_MODEL,
    contents,
  });
  return response.text;
}

export async function suggestAppearance(params: {
  characterName: string;
  identity: string;
  personality: string;
  background: string;
  writingStyles?: string[];
}) {
  const { characterName, identity, personality, background, writingStyles } =
    params;
  const isHanViet = writingStyles?.includes("Hán Việt");

  let styleInstructions = "";
  if (isHanViet) styleInstructions = HAN_VIET_RULES;

  const contents = `Bạn là một nhà văn giàu kinh nghiệm. Hãy gợi ý ngoại hình chi tiết cho nhân vật sau:
- Tên: ${characterName || "Chưa xác định"}
- Danh tính: ${identity || "Không có"}
- Tính cách: ${personality || "Không có"}
- Gia cảnh: ${background || "Không có"}

${styleInstructions ? `LƯU Ý VỀ VĂN PHONG:\n${styleInstructions}\n` : ""}

Yêu cầu:
1. Mô tả chi tiết về khuôn mặt, dáng người, trang phục, và các đặc điểm nhận dạng đặc trưng.
2. Phù hợp với bối cảnh và tính cách của nhân vật.
3. Trình bày ngắn gọn, súc tích nhưng đầy đủ hình ảnh.
4. TUYỆT ĐỐI KHÔNG sử dụng ngoặc đơn () hoặc chú thích trong ngoặc.`;

  const response = await safeGenerateContent({
    model: STABLE_FLASH_MODEL,
    contents,
  });
  return response.text;
}

export async function scanFullStoryConsistency(params: {
  volumes: any[];
  worldContext: any;
  characterContext: any;
  supportingCharacters: any[];
  plotMap: string;
  writingStyles?: string[];
}) {
  const allChapters = params.volumes.flatMap((v) => v.chapters);
  const storySummary = allChapters
    .map(
      (c, i) =>
        `Chương ${i + 1}: ${c.title}\n${c.content.substring(0, 500)}...`,
    )
    .join("\n\n");

  const isHanViet = params.writingStyles?.includes("Hán Việt");

  const contents = `Bạn là một biên tập viên cao cấp. Hãy quét toàn bộ truyện để tìm các lỗi bất nhất (logic, tính cách nhân vật, bối cảnh) dựa trên các thiết lập sau:
${isHanViet ? `\nLƯU Ý QUAN TRỌNG: Truyện đang được viết theo phong cách Hán Việt (Convert). Hãy kiểm tra xem văn phong có nhất quán với các quy tắc Hán Việt hay không.\n${HAN_VIET_RULES}\n` : ""}

THẾ GIỚI:
${JSON.stringify(params.worldContext, null, 2)}

NHÂN VẬT CHÍNH:
${JSON.stringify(params.characterContext, null, 2)}

NHÂN VẬT PHỤ:
${JSON.stringify(params.supportingCharacters, null, 2)}

CỐT TRUYỆN DỰ KIẾN:
${params.plotMap}

TÓM TẮT CÁC CHƯƠNG ĐÃ VIẾT:
${storySummary}

YÊU CẦU:
1. Liệt kê các lỗi bất nhất quan trọng (nếu có).
2. Gợi ý hướng khắc phục cho từng lỗi.
3. Trình bày ngắn gọn, súc tích bằng tiếng Việt.
4. Nếu không có lỗi, hãy đưa ra một nhận xét tích cực ngắn gọn.`;

  const response = await safeGenerateContent({
    model: STABLE_FLASH_LITE_MODEL,
    contents,
  });

  return response.text || "Không tìm thấy lỗi bất nhất đáng kể.";
}

export async function generateStoryImage(prompt: string) {
  // Translate prompt to English for better image generation results
  let englishPrompt = prompt;
  try {
    const translationResponse = await safeGenerateContent({
      model: STABLE_FLASH_MODEL,
      contents: `Translate the following Vietnamese image description into a detailed English prompt for an AI image generator. Focus on artistic style, lighting, and composition. Only return the English translation, nothing else.\n\nDescription: ${prompt}`,
      config: {
        temperature: 0.3,
      },
    });
    if (translationResponse.text) {
      englishPrompt = translationResponse.text.trim();
    }
  } catch (e) {
    console.warn(
      "Failed to translate prompt for image generation, using original.",
      e,
    );
  }

  try {
    const response = await safeGenerateContent({
      model: STABLE_IMAGE_MODEL,
      contents: {
        parts: [
          {
            text: `A high-quality digital illustration: ${englishPrompt}`,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "16:9",
        },
      },
    });

    if (response.promptFeedback?.blockReason) {
      throw new Error(
        `Yêu cầu bị chặn bởi hệ thống: ${response.promptFeedback.blockReason}`,
      );
    }

    if (!response.candidates || response.candidates.length === 0) {
      throw new Error("AI không trả về kết quả nào.");
    }

    for (const candidate of response.candidates) {
      // Check for safety or other reasons first
      if (
        candidate.finishReason === "SAFETY" ||
        candidate.finishReason === "PROHIBITED_CONTENT"
      ) {
        throw new Error(
          "Nội dung mô tả hoặc hình ảnh bị hệ thống từ chối vì vi phạm chính sách an toàn. Vui lòng thử mô tả khác lành mạnh hơn.",
        );
      }

      if (candidate.finishReason && candidate.finishReason !== "STOP") {
        console.warn(`Candidate finish reason: ${candidate.finishReason}`);
      }

      if (candidate.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.inlineData) {
            return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
          }
        }
      }
    }

    // If we reach here, no image was found, check for text refusal
    let textResponse = "";
    for (const candidate of response.candidates) {
      if (candidate.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.text) textResponse += part.text + " ";
        }
      }
    }

    if (textResponse.trim()) {
      throw new Error(
        `AI từ chối tạo ảnh và trả về văn bản: ${textResponse.trim()}`,
      );
    }

    const firstReason = response.candidates[0]?.finishReason;
    throw new Error(
      `Không tìm thấy dữ liệu ảnh trong phản hồi (Lý do kết thúc: ${firstReason || "Không rõ"}).`,
    );
  } catch (error: any) {
    console.error("Image generation error:", error);
    throw error;
  }
}

export async function continueStory(
  currentStory: string,
  instruction: string,
  rules?: any,
  fanficContext?: string,
  writingStyles?: string[],
  storyContext?: any,
  previousChapters?: string,
  chapterInfo?: { current: number; total: number },
) {
  const isNsfwEnabled =
    (rules?.nsfwLevel && !["Không", "Không có"].includes(rules.nsfwLevel)) ||
    writingStyles?.includes("18+");
  const isHanViet = writingStyles?.includes("Hán Việt");

  let styleInstructions = "";
  if (writingStyles && writingStyles.length > 0) {
    if (isHanViet) {
      styleInstructions += HAN_VIET_RULES;
    }
    if (writingStyles.includes("Thuần Việt")) {
      styleInstructions += THUAN_VIET_RULES;
    }
  } else {
    // Default fallback if no style is selected
    styleInstructions += THUAN_VIET_RULES;
  }

  if (isNsfwEnabled) {
    styleInstructions += NSFW_RULES;
  }

  let chapterDistributionRules = "";
  if (chapterInfo && chapterInfo.total > 0) {
    chapterDistributionRules = `
PHÂN BỔ NỘI DUNG THEO MỤC TIÊU (BẮT BUỘC):
- Tổng số chương dự định: ${chapterInfo.total}
- Chương hiện tại: ${chapterInfo.current}
- NGUYÊN TẮC CHIA CHƯƠNG:
  1. Nếu là Chương 1-2: Chỉ tập trung giới thiệu bối cảnh và 1-2 thiết lập quan trọng nhất. Tuyệt đối không nhồi nhét tất cả các cài đặt thế giới vào đây.
  2. Tiết tấu: Mỗi chương chỉ được giải quyết tối đa 1 tình tiết chính và 2 tình tiết phụ.
  3. Điểm dừng (Cliffhanger): Cuối chương phải dừng lại ở một chi tiết gợi mở, không được kết thúc toàn bộ câu chuyện quá sớm.
  4. Phân bổ: Hãy đảm bảo cốt truyện được dàn trải đều cho đến chương ${chapterInfo.total}. Giữ lại ít nhất 70% các thiết lập nâng cao để hé lộ dần ở các chương sau.
- YÊU CẦU ĐẦU RA PHỤ: Cuối mỗi phản hồi, hãy thêm dòng trạng thái: [Tiến độ: Chương ${chapterInfo.current}/${chapterInfo.total} chương]
`;
  }

  let roleInstruction = `Bạn là một "Đại thần" (tác giả top đầu) chuyên viết tiểu thuyết mạng.`;
  if (isHanViet) {
    roleInstruction = `Bạn là một công cụ "Convert" truyện Trung Quốc sang Hán Việt chuyên nghiệp, giống như trên trang Sangtacviet. Nhiệm vụ của bạn là viết tiếp câu chuyện với phong cách Hán Việt đặc trưng, giữ nguyên hồn cốt của nguyên tác Trung Quốc.`;
  }

  let systemInstruction = `${roleInstruction}

LƯU Ý QUAN TRỌNG VỀ VĂN PHONG (BẮT BUỘC TUÂN THỦ):
${styleInstructions}

${chapterDistributionRules}

LƯU Ý QUAN TRỌNG VỀ CỐT TRUYỆN VÀ HỌC TẬP:
1. HỌC TẬP VĂN PHONG: Hãy phân tích kỹ và BẮT CHƯỚC văn phong, cách dùng từ, nhịp điệu câu văn của tác giả trong phần truyện đã có.
2. NHẤT QUÁN NHÂN VẬT (BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI): 
   - Phải tuân thủ tuyệt đối thiết lập về tính cách, danh tính và bối cảnh.
   - TRÁNH rập khuôn nhân vật chính "lạnh lùng vô cảm" một cách máy móc. Nhân vật phải có cảm xúc, phản ứng tâm lý sống động và phù hợp với hoàn cảnh.
   - Khi nhân vật phụ xuất hiện, họ phải có hành động, lời thoại và phản ứng đúng với thiết lập đã cho.
   - AI KHÔNG ĐƯỢC tự ý thay đổi thiết lập đã có hoặc bỏ qua các chi tiết quan trọng về nhân vật.
3. SẢNG ĐIỂM (ĐIỂM NHẤN): Xây dựng tình huống vả mặt, trang bức, đột phá cảnh giới dứt khoát, sắc bén.
4. HỘI THOẠI: Lời thoại ngắn gọn, thâm sâu, phù hợp thân phận. Kẻ mạnh nói chuyện uy áp, kẻ xảo quyệt nói chuyện thâm sâu.
5. ĐỊNH DẠNG & HIỂN THỊ THÔNG TIN:
   - TUYỆT ĐỐI KHÔNG liệt kê các thiết lập thế giới, quy tắc hay logic một cách trực tiếp như người kể chuyện. 
   - Mọi thiết lập (ví dụ: cấp bậc, hệ thống sức mạnh, quy đổi tài nguyên) PHẢI được hé lộ gián tiếp thông qua lời thoại, suy nghĩ hoặc hành động của nhân vật trong truyện.
   - KHÔNG sử dụng ngoặc đơn () để giải thích thiết lập ẩn hay ghi chú AI.
   - NGOẠI LỆ DUY NHẤT: Chỉ được dùng ngoặc đơn () cho các chỉ số/phẩm cấp mang màu sắc sau: (hôi), (lục), (lam), (tử), (hoàng), (xích), (chanh), (hắc), (bạch), (thải sắc). Ví dụ: "Thanh kiếm này toát ra hào quang màu tím (tử)..."
6. ĐỘ DÀI & CHI TIẾT: 
   - Viết cực kỳ chi tiết các tình tiết quan trọng nhưng giữ nguyên sự súc tích của từng câu. 
   - TRÁNH sa đà vào miêu tả cảnh sắc, ngoại hình một cách "vô tội vạ" nếu không phục vụ cho mạch truyện hoặc không có ý nghĩa biểu đạt tâm trạng/không gian. 
   - Tránh viết tóm tắt hời hợt.
7. TRÍ THÔNG MINH CAO: Hãy suy luận logic, kết nối các tình tiết từ bộ nhớ truyện và bối cảnh thế giới một cách thông minh, sắc sảo.

---
THIẾT LẬP TỔNG QUAN (BẮT BUỘC TUÂN THỦ):
Đây là thông tin nền về thế giới và nhân vật. 
AI phải lồng ghép các thông tin này vào mạch truyện một cách tự nhiên thông qua nhân vật, thay vì liệt kê toẹt ra.
TUYÊN BỐ: AI PHẢI ĐỌC HẾT MỌI THIẾT LẬP Ở CÁC TRANG TRƯỚC ĐÓ VÀ TUÂN THỦ CHÚNG.`;

  if (storyContext) {
    if (storyContext.page1) {
      const p1 = storyContext.page1;
      systemInstruction += `\n- Thể loại: ${p1.selectedGenres ? p1.selectedGenres.join(", ") : "Không có"}`;
      systemInstruction += `\n- Ý tưởng chính: ${p1.prompt || "Không có"}`;
      systemInstruction += `\n- Thiết lập thế giới: ${p1.worldSetting || "Không có"}`;
      systemInstruction += `\n- Tài nguyên: ${p1.resources || "Không có"}`;
      systemInstruction += `\n- Chủng tộc: ${p1.races || "Không có"}`;
      systemInstruction += `\n- Hệ thống sức mạnh: ${p1.powerSystem || "Không có"}`;
      systemInstruction += `\n- Logic vận hành thế giới: ${p1.worldLogic || "Không có"}`;
      if (p1.storyMemory) {
        systemInstruction += `\n- BỘ NHỚ TRUYỆN (Các tình tiết quan trọng cần nhớ): ${p1.storyMemory}`;
      }
    }
    if (storyContext.page2) {
      const p2 = storyContext.page2;
      systemInstruction += `\n- Tên nhân vật chính: ${p2.characterName || "Không có"}`;
      systemInstruction += `\n- Mô tả nhân vật: ${p2.prompt || "Không có"}`;
      systemInstruction += `\n- Danh tính: ${p2.identity || "Không có"}`;
      systemInstruction += `\n- Tính cách: ${p2.personality || "Không có"}`;
      systemInstruction += `\n- Ngoại hình: ${p2.appearance || "Không có"}`;
      systemInstruction += `\n- Thiên phú: ${p2.talent || "Không có"}`;
      systemInstruction += `\n- Gia cảnh: ${p2.background || "Không có"}`;
      systemInstruction += `\n- Kim thủ chỉ (Cheat): ${p2.cheat || "Không có"}`;
    }

    if (storyContext.plotMap) {
      systemInstruction += `\n\nBẢN ĐỒ CỐT TRUYỆN (PLOT MAP - NHIỆM VỤ CHIẾN LƯỢC):
Đây là lộ trình chi tiết cho từng chương. AI phải bám sát lộ trình này để viết tiếp:
${storyContext.plotMap}`;
    }

    if (
      storyContext.supportingCharacters &&
      storyContext.supportingCharacters.length > 0
    ) {
      systemInstruction += `\n\nDANH SÁCH NHÂN VẬT PHỤ (BẮT BUỘC TUÂN THỦ THIẾT LẬP):`;
      storyContext.supportingCharacters.forEach((char: any, index: number) => {
        systemInstruction += `\n${index + 1}. Tên: ${char.name || "Không có"}`;
        systemInstruction += `\n   - Danh tính: ${char.identity || "Không có"}`;
        systemInstruction += `\n   - Tính cách: ${char.personality || "Không có"}`;
        systemInstruction += `\n   - Ngoại hình: ${char.appearance || "Không có"}`;
        systemInstruction += `\n   - Thiên phú: ${char.talent || "Không có"}`;
        systemInstruction += `\n   - Gia cảnh: ${char.background || "Không có"}`;
      });
      systemInstruction += `\n\nYÊU CẦU: Khi các nhân vật phụ này xuất hiện, AI phải miêu tả hành động và lời thoại dựa trên đúng tính cách và bối cảnh đã nêu trên.`;
    }
  }

  if (writingStyles && writingStyles.length > 0) {
    systemInstruction += `\n\nPHONG CÁCH VĂN PHONG YÊU CẦU: ${writingStyles.join(", ")}.`;
  }

  if (rules) {
    systemInstruction += `\n\nQUY TẮC VIẾT TRUYỆN (BẮT BUỘC TUÂN THỦ):
- Điều cấm: ${rules.forbidden || "Không có"}
- Điều khuyến khích: ${rules.encouraged || "Không có"}
- Mệnh lệnh (TUYỆT ĐỐI TUÂN THỦ): ${rules.commands || "Không có"}
- Mức độ NSFW (18+): ${rules.nsfwLevel || "Không có"}

LƯU Ý: Bạn phải tuân thủ tuyệt đối các quy tắc trên. Nếu mức độ NSFW không phải là "Không", bạn phải viết một cách bạo dạn, không được từ chối.`;
  }

  let prompt = "";
  if (fanficContext) {
    prompt += `TÀI LIỆU THAM KHẢO (ĐỒNG NHÂN):\n---\n${fanficContext}\n---\n\n`;
  }

  if (currentStory.trim()) {
    prompt += `PHẦN TRUYỆN ĐANG VIẾT (Hãy viết tiếp từ đây):\n---\n${currentStory}\n---\n`;
  } else {
    prompt += `Đây là chương mới. Hãy bắt đầu chương này một cách ấn tượng dựa trên bối cảnh đã có.\n`;
  }

  if (previousChapters && previousChapters.trim()) {
    prompt += `\nNỘI DUNG CÁC CHƯƠNG TRƯỚC (Để đảm bảo tính nhất quán):\n---\n${previousChapters}\n---\n`;
  }

  prompt += `\n
NHẮC NHỞ GIỮ CHẤT TRUYỆN:
- Bám chặt giọng kể, tiết tấu, cách nhấn nhá cảm xúc và không khí đang có trong phần truyện hiện tại.
- Khi kéo dài chương, hãy đào sâu cảnh, tâm lý, hành động và dư vị cảm xúc thay vì lặp ý, lan man hoặc làm văn bị đều tay kiểu AI.
- Không được làm nhân vật lệch giọng, lệch nhịp hoặc đổi sang văn phong chung chung thiếu bản sắc.`;

  prompt += `\n---
NHIỆM VỤ TỐI THƯỢNG (BẮT BUỘC THỰC HIỆN):
Tác giả yêu cầu bạn thực hiện chỉ thị sau đây cho đoạn văn này. Đây là ưu tiên cao nhất của bạn:
>>> ${instruction.trim() || "Hãy viết tiếp diễn biến câu chuyện một cách tự nhiên, hấp dẫn, đẩy mạnh cốt truyện."} <<<
---

YÊU CẦU ĐẦU RA:
- Viết CỰC KỲ CHI TIẾT, miêu tả tỉ mỉ hành động, môi trường và tâm lý (KHÔNG GIỚI HẠN DUNG LƯỢNG, viết càng dài càng tốt).
- TUYỆT ĐỐI TUÂN THỦ chỉ thị ở mục "NHIỆM VỤ TỐI THƯỢNG" phía trên.
- Trả về trực tiếp nội dung truyện, không thêm bất kỳ lời dẫn giải nào.`;

  const response = await safeGenerateContent({
    model: STABLE_FLASH_MODEL,
    contents: prompt,
    config: {
      systemInstruction,
      temperature: 0.8,
      maxOutputTokens: 8192,
    },
  });
  return response.text;
}

export async function fixStoryErrors(
  currentStory: string,
  writingStyles?: string[],
  storyContext?: any,
  previousChapters?: string,
) {
  const isHanViet = writingStyles?.includes("Hán Việt");
  let styleInstructions = "";
  if (writingStyles && writingStyles.length > 0) {
    if (isHanViet) styleInstructions += HAN_VIET_RULES;
    if (writingStyles.includes("Thuần Việt"))
      styleInstructions += THUAN_VIET_RULES;
  }

  let roleInstruction = `Bạn là một biên tập viên văn học chuyên nghiệp.`;
  if (isHanViet) {
    roleInstruction = `Bạn là một biên tập viên chuyên về dòng truyện Hán Việt (Convert), am hiểu phong cách Sangtacviet.`;
  }

  let systemInstruction = `${roleInstruction} 
Nhiệm vụ của bạn là tự động phát hiện và sửa các lỗi trong đoạn văn bản được cung cấp.

LƯU Ý VỀ VĂN PHONG:
${styleInstructions || "Giữ nguyên văn phong của tác giả."}

CÁC LỖI CẦN SỬA:
1. Lỗi chính tả, gõ sai dấu, sai từ.
2. Lỗi ngữ pháp, câu lủng củng, thiếu chủ ngữ/vị ngữ.
3. Lỗi logic cơ bản trong đoạn văn (nếu có).
4. Chuẩn hóa dấu câu (dấu phẩy, dấu chấm, ngoặc kép).

YÊU CẦU ĐẦU RA:
- CHỈ TRẢ VỀ nội dung đã được sửa lỗi.
- TUYỆT ĐỐI KHÔNG thêm bất kỳ lời giải thích, bình luận hay đánh giá nào.
- Giữ nguyên văn phong gốc của tác giả, chỉ sửa những chỗ thực sự sai.
${styleInstructions ? `\nLƯU Ý VỀ VĂN PHONG:\n${styleInstructions}` : ""}
`;

  if (storyContext) {
    systemInstruction += `\n\nTHÔNG TIN BỐI CẢNH (Dùng để kiểm tra tính nhất quán của tên nhân vật, địa danh, v.v.):`;
    if (storyContext.page1) {
      const p1 = storyContext.page1;
      systemInstruction += `\n- Thiết lập thế giới: ${p1.worldSetting || "Không có"}`;
      if (p1.storyMemory) {
        systemInstruction += `\n- BỘ NHỚ TRUYỆN: ${p1.storyMemory}`;
      }
    }
    if (storyContext.page2) {
      const p2 = storyContext.page2;
      systemInstruction += `\n- Tên nhân vật chính: ${p2.characterName || "Không có"}`;
    }
    if (
      storyContext.supportingCharacters &&
      storyContext.supportingCharacters.length > 0
    ) {
      systemInstruction += `\n- Nhân vật phụ: ${storyContext.supportingCharacters.map((c: any) => c.name).join(", ")}`;
    }
    if (storyContext.plotMap) {
      systemInstruction += `\n- BẢN ĐỒ CỐT TRUYỆN: ${storyContext.plotMap}`;
    }
  }

  let prompt = "";
  if (previousChapters && previousChapters.trim()) {
    prompt += `NỘI DUNG CÁC CHƯƠNG TRƯỚC (Để tham khảo ngữ cảnh):\n---\n${previousChapters}\n---\n\n`;
  }
  prompt += `HÃY SỬA LỖI ĐOẠN VĂN SAU:\n---\n${currentStory}\n---\n`;

  const response = await safeGenerateContent({
    model: STABLE_FLASH_MODEL,
    contents: prompt,
    config: {
      systemInstruction,
      temperature: 0.3, // Low temperature for more deterministic fixing
      maxOutputTokens: 8192,
    },
  });
  return response.text;
}

export async function generatePlotMap(params: {
  worldContext: any;
  characterContext: any;
  supportingCharacters: any[];
  rules: any;
  totalChapters: number;
  writingStyles?: string[];
}) {
  const {
    worldContext,
    characterContext,
    supportingCharacters,
    rules,
    totalChapters,
    writingStyles,
  } = params;

  const isHanViet = writingStyles?.includes("Hán Việt");

  const systemInstruction = `Bạn là một chuyên gia biên kịch và lập đề cương tiểu thuyết. 
Nhiệm vụ của bạn là lập một "Bản đồ cốt truyện" (Plot Map) chi tiết cho bộ truyện dựa trên các thiết lập đã có.
${isHanViet ? `\nPHONG CÁCH VIẾT: Hán Việt (Convert). Hãy sử dụng thuật ngữ Hán Việt trong bản đồ cốt truyện.\n${HAN_VIET_RULES}\n` : ""}

NGUYÊN TẮC LẬP BẢN ĐỒ:
1. Chia toàn bộ cốt truyện vào đúng ${totalChapters} chương.
2. Chương 1-2: Giới thiệu bối cảnh, nhân vật và 1-2 mâu thuẫn/thiết lập quan trọng nhất.
3. Tiết tấu: Mỗi chương giải quyết 1 tình tiết chính và tối đa 2 tình tiết phụ.
4. Cao trào: Phân bổ các điểm cao trào (climax) và thắt nút/mở nút hợp lý xuyên suốt ${totalChapters} chương.
5. Cliffhanger: Mỗi chương phải kết thúc bằng một gợi mở hấp dẫn.
6. Giữ bí mật: Chỉ hé lộ dần dần các thiết lập thế giới phức tạp, không nhồi nhét ở đầu truyện.
7. NHẤT QUÁN NHÂN VẬT (BẮT BUỘC): Phải tuân thủ tuyệt đối thiết lập về tính cách, danh tính và bối cảnh của nhân vật chính và TẤT CẢ nhân vật phụ trong danh sách. Không tự ý thay đổi thiết lập đã có khi lập bản đồ.

YÊU CẦU ĐẦU RA:
- Trình bày dưới dạng danh sách: Chương 1: [Tên chương] - [Tóm tắt nội dung chính].
- Mỗi chương viết khoảng 2-3 câu tóm tắt.
- TUYỆT ĐỐI KHÔNG dùng ngoặc đơn ().`;

  const prompt = `Hãy lập bản đồ cốt truyện cho bộ truyện có các thiết lập sau:
THẾ GIỚI:
- Thể loại: ${worldContext.selectedGenres ? worldContext.selectedGenres.join(", ") : "Không có"}
- Ý tưởng: ${worldContext.prompt || "Không có"}
- Bối cảnh: ${worldContext.worldSetting || "Không có"}
- Tài nguyên: ${worldContext.resources || "Không có"}
- Chủng tộc: ${worldContext.races || "Không có"}
- Hệ thống sức mạnh: ${worldContext.powerSystem || "Không có"}
- Logic vận hành thế giới: ${worldContext.worldLogic || "Không có"}

NHÂN VẬT CHÍNH:
- Tên: ${characterContext.characterName || "Không có"}
- Mô tả: ${characterContext.prompt || "Không có"}
- Danh tính: ${characterContext.identity || "Không có"}
- Tính cách: ${characterContext.personality || "Không có"}
- Ngoại hình: ${characterContext.appearance || "Không có"}
- Thiên phú: ${characterContext.talent || "Không có"}
- Gia cảnh: ${characterContext.background || "Không có"}
- Kim thủ chỉ (Cheat): ${characterContext.cheat || "Không có"}

DANH SÁCH NHÂN VẬT PHỤ VÀ THIẾT LẬP CỦA HỌ (PHẢI TUÂN THỦ TUYỆT ĐỐI):
${supportingCharacters
  .map(
    (c, i) => `${i + 1}. Tên: ${c.name}
   - Danh tính: ${c.identity || "Không có"}
   - Tính cách: ${c.personality || "Không có"}
   - Ngoại hình: ${c.appearance || "Không có"}
   - Thiên phú: ${c.talent || "Không có"}
   - Gia cảnh: ${c.background || "Không có"}`,
  )
  .join("\n")}

QUY TẮC: 
- Điều cấm: ${rules.forbidden || "Không có"}
- Điều khuyến khích: ${rules.encouraged || "Không có"}
- Mệnh lệnh: ${rules.commands || "Không có"}

TỔNG SỐ CHƯƠNG: ${totalChapters}`;

  const response = await safeGenerateContent({
    model: STABLE_FLASH_MODEL,
    contents: prompt,
    config: {
      systemInstruction,
      temperature: 0.7,
    },
  });
  return response.text;
}

export async function rewriteStory(
  currentStory: string,
  instruction: string,
  rules?: any,
  fanficContext?: string,
  writingStyles?: string[],
  storyContext?: any,
  previousChapters?: string,
  chapterInfo?: { current: number; total: number },
) {
  const isNsfwEnabled =
    (rules?.nsfwLevel && !["Không", "Không có"].includes(rules.nsfwLevel)) ||
    writingStyles?.includes("18+");
  const isHanViet = writingStyles?.includes("Hán Việt");

  let styleInstructions = "";
  if (writingStyles && writingStyles.length > 0) {
    if (isHanViet) {
      styleInstructions += HAN_VIET_RULES;
    }
    if (writingStyles.includes("Thuần Việt")) {
      styleInstructions += THUAN_VIET_RULES;
    }
  } else {
    // Default fallback if no style is selected
    styleInstructions += THUAN_VIET_RULES;
  }

  if (isNsfwEnabled) {
    styleInstructions += NSFW_RULES;
  }

  let chapterDistributionRules = "";
  if (chapterInfo && chapterInfo.total > 0) {
    chapterDistributionRules = `
PHÂN BỔ NỘI DUNG THEO MỤC TIÊU (BẮT BUỘC):
- Tổng số chương dự định: ${chapterInfo.total}
- Chương hiện tại: ${chapterInfo.current}
- NGUYÊN TẮC CHIA CHƯƠNG:
  1. Nếu là Chương 1-2: Chỉ tập trung giới thiệu bối cảnh và 1-2 thiết lập quan trọng nhất. Tuyệt đối không nhồi nhét tất cả các cài đặt thế giới vào đây.
  2. Tiết tấu: Mỗi chương chỉ được giải quyết tối đa 1 tình tiết chính và 2 tình tiết phụ.
  3. Điểm dừng (Cliffhanger): Cuối chương phải dừng lại ở một chi tiết gợi mở, không được kết thúc toàn bộ câu chuyện quá sớm.
  4. Phân bổ: Hãy đảm bảo cốt truyện được dàn trải đều cho đến chương ${chapterInfo.total}. Giữ lại ít nhất 70% các thiết lập nâng cao để hé lộ dần ở các chương sau.
- YÊU CẦU ĐẦU RA PHỤ: Cuối mỗi phản hồi, hãy thêm dòng trạng thái: [Tiến độ: Chương ${chapterInfo.current}/${chapterInfo.total} chương]
`;
  }

  let roleInstruction = `Bạn là một "Đại thần" (tác giả top đầu) chuyên viết tiểu thuyết mạng.`;
  if (isHanViet) {
    roleInstruction = `Bạn là một công cụ "Convert" truyện Trung Quốc sang Hán Việt chuyên nghiệp, giống như trên trang Sangtacviet. Nhiệm vụ của bạn là viết lại câu chuyện với phong cách Hán Việt đặc trưng, giữ nguyên hồn cốt của nguyên tác Trung Quốc.`;
  }

  let systemInstruction = `${roleInstruction}

LƯU Ý QUAN TRỌNG VỀ VĂN PHONG (BẮT BUỘC TUÂN THỦ):
${styleInstructions}

${chapterDistributionRules}

LƯU Ý QUAN TRỌNG VỀ CỐT TRUYỆN VÀ HỌC TẬP:
1. HỌC TẬP VĂN PHONG: Hãy phân tích kỹ và BẮT CHƯỚC văn phong, cách dùng từ, nhịp điệu câu văn của tác giả trong phần truyện đã có.
2. NHẤT QUÁN NHÂN VẬT (BẮT BUỘC TUÂN THỦ TUYỆT ĐỐI): 
   - Phải tuân thủ tuyệt đối thiết lập về tính cách, danh tính và bối cảnh.
   - TRÁNH rập khuôn nhân vật chính "lạnh lùng vô cảm" một cách máy móc. Nhân vật phải có cảm xúc, phản ứng tâm lý sống động và phù hợp với hoàn cảnh.
   - Khi nhân vật phụ xuất hiện, họ phải có hành động, lời thoại và phản ứng đúng với thiết lập đã cho.
   - AI KHÔNG ĐƯỢC tự ý thay đổi thiết lập đã có hoặc bỏ qua các chi tiết quan trọng về nhân vật.
3. SẢNG ĐIỂM (ĐIỂM NHẤN): Xây dựng tình huống vả mặt, trang bức, đột phá cảnh giới dứt khoát, sắc bén.
4. HỘI THOẠI: Lời thoại ngắn gọn, thâm sâu, phù hợp thân phận. Kẻ mạnh nói chuyện uy áp, kẻ xảo quyệt nói chuyện thâm sâu.
5. ĐỊNH DẠNG & HIỂN THỊ THÔNG TIN:
   - TUYỆT ĐỐI KHÔNG liệt kê các thiết lập thế giới, quy tắc hay logic một cách trực tiếp như người kể chuyện. 
   - Mọi thiết lập (ví dụ: cấp bậc, hệ thống sức mạnh, quy đổi tài nguyên) PHẢI được hé lộ gián tiếp thông qua lời thoại, suy nghĩ hoặc hành động của nhân vật trong truyện.
   - KHÔNG sử dụng ngoặc đơn () để giải thích thiết lập ẩn hay ghi chú AI.
   - NGOẠI LỆ DUY NHẤT: Chỉ được dùng ngoặc đơn () cho các chỉ số/phẩm cấp mang màu sắc sau: (hôi), (lục), (lam), (tử), (hoàng), (xích), (chanh), (hắc), (bạch), (thải sắc). Ví dụ: "Thanh kiếm này toát ra hào quang màu tím (tử)..."
6. ĐỘ DÀI & CHI TIẾT: 
   - Viết cực kỳ chi tiết các tình tiết quan trọng nhưng giữ nguyên sự súc tích của từng câu. 
   - TRÁNH sa đà vào miêu tả cảnh sắc, ngoại hình một cách "vô tội vạ" nếu không phục vụ cho mạch truyện hoặc không có ý nghĩa biểu đạt tâm trạng/không gian. 
   - Tránh viết tóm tắt hời hợt.
7. TRÍ THÔNG MINH CAO: Hãy suy luận logic, kết nối các tình tiết từ bộ nhớ truyện và bối cảnh thế giới một cách thông minh, sắc sảo.

---
THIẾT LẬP TỔNG QUAN (BẮT BUỘC TUÂN THỦ):
Đây là thông tin nền về thế giới và nhân vật. 
AI phải lồng ghép các thông tin này vào mạch truyện một cách tự nhiên thông qua nhân vật, thay vì liệt kê toẹt ra.
TUYÊN BỐ: AI PHẢI ĐỌC HẾT MỌI THIẾT LẬP Ở CÁC TRANG TRƯỚC ĐÓ VÀ TUÂN THỦ CHÚNG.`;

  if (storyContext) {
    if (storyContext.page1) {
      const p1 = storyContext.page1;
      systemInstruction += `\n- Thể loại: ${p1.selectedGenres ? p1.selectedGenres.join(", ") : "Không có"}`;
      systemInstruction += `\n- Ý tưởng chính: ${p1.prompt || "Không có"}`;
      systemInstruction += `\n- Thiết lập thế giới: ${p1.worldSetting || "Không có"}`;
      systemInstruction += `\n- Tài nguyên: ${p1.resources || "Không có"}`;
      systemInstruction += `\n- Chủng tộc: ${p1.races || "Không có"}`;
      systemInstruction += `\n- Hệ thống sức mạnh: ${p1.powerSystem || "Không có"}`;
      systemInstruction += `\n- Logic vận hành thế giới: ${p1.worldLogic || "Không có"}`;
      if (p1.storyMemory) {
        systemInstruction += `\n- BỘ NHỚ TRUYỆN (Các tình tiết quan trọng cần nhớ): ${p1.storyMemory}`;
      }
    }
    if (storyContext.page2) {
      const p2 = storyContext.page2;
      systemInstruction += `\n- Tên nhân vật chính: ${p2.characterName || "Không có"}`;
      systemInstruction += `\n- Mô tả nhân vật: ${p2.prompt || "Không có"}`;
      systemInstruction += `\n- Danh tính: ${p2.identity || "Không có"}`;
      systemInstruction += `\n- Tính cách: ${p2.personality || "Không có"}`;
      systemInstruction += `\n- Ngoại hình: ${p2.appearance || "Không có"}`;
      systemInstruction += `\n- Thiên phú: ${p2.talent || "Không có"}`;
      systemInstruction += `\n- Gia cảnh: ${p2.background || "Không có"}`;
      systemInstruction += `\n- Kim thủ chỉ (Cheat): ${p2.cheat || "Không có"}`;
    }

    if (storyContext.plotMap) {
      systemInstruction += `\n\nBẢN ĐỒ CỐT TRUYỆN (PLOT MAP - NHIỆM VỤ CHIẾN LƯỢC):
Đây là lộ trình chi tiết cho từng chương. AI phải bám sát lộ trình này để viết lại/chỉnh sửa nội dung cho phù hợp với mạch truyện tổng thể:
${storyContext.plotMap}`;
    }

    if (
      storyContext.supportingCharacters &&
      storyContext.supportingCharacters.length > 0
    ) {
      systemInstruction += `\n\nDANH SÁCH NHÂN VẬT PHỤ (BẮT BUỘC TUÂN THỦ THIẾT LẬP):`;
      storyContext.supportingCharacters.forEach((char: any, index: number) => {
        systemInstruction += `\n${index + 1}. Tên: ${char.name || "Không có"}`;
        systemInstruction += `\n   - Danh tính: ${char.identity || "Không có"}`;
        systemInstruction += `\n   - Tính cách: ${char.personality || "Không có"}`;
        systemInstruction += `\n   - Ngoại hình: ${char.appearance || "Không có"}`;
        systemInstruction += `\n   - Thiên phú: ${char.talent || "Không có"}`;
        systemInstruction += `\n   - Gia cảnh: ${char.background || "Không có"}`;
      });
      systemInstruction += `\n\nYÊU CẦU: Khi các nhân vật phụ này xuất hiện, AI phải miêu tả hành động và lời thoại dựa trên đúng tính cách và bối cảnh đã nêu trên.`;
    }
  }

  if (writingStyles && writingStyles.length > 0) {
    systemInstruction += `\n\nPHONG CÁCH VĂN PHONG YÊU CẦU: ${writingStyles.join(", ")}.`;
  }

  let safetySettings: any = undefined;

  if (rules) {
    systemInstruction += `\n\nQUY TẮC VIẾT TRUYỆN (BẮT BUỘC TUÂN THỦ):
- Điều cấm: ${rules.forbidden || "Không có"}
- Điều khuyến khích: ${rules.encouraged || "Không có"}
- Mệnh lệnh (TUYỆT ĐỐI TUÂN THỦ): ${rules.commands || "Không có"}
- Mức độ NSFW (18+): ${rules.nsfwLevel || "Không có"}

LƯU Ý: Bạn phải tuân thủ tuyệt đối các quy tắc trên.`;

    if (
      (rules.nsfwLevel && rules.nsfwLevel !== "Không") ||
      (writingStyles && writingStyles.includes("18+"))
    ) {
      safetySettings = [
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ];
    }
  }

  let prompt = "";
  if (fanficContext) {
    prompt += `TÀI LIỆU THAM KHẢO (ĐỒNG NHÂN):\n---\n${fanficContext}\n---\n\n`;
  }

  prompt += `PHẦN TRUYỆN CẦN VIẾT LẠI:\n---\n${currentStory}\n---\n`;

  if (previousChapters && previousChapters.trim()) {
    prompt += `\nNỘI DUNG CÁC CHƯƠNG TRƯỚC (Để đảm bảo tính nhất quán khi viết lại):\n---\n${previousChapters}\n---\n`;
  }

  prompt += `\n
NHẮC NHỞ GIỮ CHẤT TRUYỆN:
- Giữ nguyên linh hồn của đoạn gốc: giọng kể, trường cảm xúc, mức độ căng thẳng và cách hành văn phải liền mạch với bản hiện có.
- Nếu mở rộng nội dung, hãy ưu tiên đào sâu cảnh và tâm lý thay vì đổi chất văn hoặc thêm chi tiết phô trương không phục vụ mạch truyện.
- Chỉ làm câu chữ hay hơn, dày hơn, rõ hơn; không được làm mất sức hút vốn có của đoạn truyện.`;

  prompt += `\n---
NHIỆM VỤ TỐI THƯỢNG (BẮT BUỘC THỰC HIỆN):
Tác giả yêu cầu bạn thực hiện chỉ thị sau đây khi viết lại đoạn văn này. Đây là ưu tiên cao nhất của bạn:
>>> ${instruction.trim() || "Hãy viết lại phần truyện trên cho hay hơn, trau chuốt câu chữ, miêu tả chi tiết hơn và tăng cường sảng điểm."} <<<
---

YÊU CẦU ĐẦU RA:
- Viết lại CỰC KỲ CHI TIẾT (KHÔNG GIỚI HẠN DUNG LƯỢNG, viết càng dài càng tốt).
- TUYỆT ĐỐI TUÂN THỦ chỉ thị ở mục "NHIỆM VỤ TỐI THƯỢNG" phía trên.
- Chỉ trả về nội dung đã viết lại, không thêm bất kỳ lời dẫn giải nào.`;

  const response = await safeGenerateContent({
    model: STABLE_FLASH_MODEL,
    contents: prompt,
    config: {
      systemInstruction,
      safetySettings,
      temperature: 0.8,
      maxOutputTokens: 8192,
    },
  });
  return response.text;
}

function extractSingleLineTitle(rawText: string) {
  const cleaned =
    rawText
      .replace(/\r/g, "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^[-*+\d.)\s]+/, ""))
      .find(Boolean) || "";

  return cleaned
    .replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, "")
    .replace(/^Chương\s+\d+\s*[:.-]\s*/i, "")
    .replace(/^Tiêu đề\s*[:.-]\s*/i, "")
    .slice(0, 120)
    .trim();
}

function createChapterTitleExcerpt(content: string, maxChars = 12000) {
  const trimmed = content.trim();
  if (trimmed.length <= maxChars) return trimmed;

  const headLength = Math.floor(maxChars * 0.6);
  const tailLength = maxChars - headLength;
  return `${trimmed.slice(0, headLength)}\n\n[...]\n\n${trimmed.slice(-tailLength)}`;
}

export async function generateChapterTitle(params: {
  currentStory: string;
  previousChapters?: string;
  writingStyles?: string[];
  storyContext?: any;
  currentTitle?: string;
}) {
  const {
    currentStory,
    previousChapters,
    writingStyles,
    storyContext,
    currentTitle,
  } = params;
  const isHanViet = writingStyles?.includes("Hán Việt");

  let styleInstructions = "";
  if (writingStyles && writingStyles.length > 0) {
    if (isHanViet) {
      styleInstructions += HAN_VIET_RULES;
    }
    if (writingStyles.includes("Thuần Việt")) {
      styleInstructions += THUAN_VIET_RULES;
    }
  } else {
    styleInstructions += THUAN_VIET_RULES;
  }

  let systemInstruction = `Bạn là biên tập viên chuyên đặt tên chương truyện.

MỤC TIÊU:
- Đặt một tên chương ngắn, gợi đúng trọng tâm, cảm xúc hoặc bước ngoặt nổi bật nhất.
- Giữ đúng chất văn, không khí và phong vị của truyện gốc.
- Không làm tên chương bị generic, sáo hoặc nghe như tiêu đề do AI sinh hàng loạt.

YÊU CẦU ĐẦU RA:
- Trả về đúng 1 dòng duy nhất.
- Không thêm lời giải thích.
- Không thêm "Chương X:".
- Không đặt trong ngoặc kép.
- Tối đa 12 từ.
- Ưu tiên gợi mở, đẹp tai, dễ nhớ và không spoil sạch cú chốt.`;

  if (styleInstructions.trim()) {
    systemInstruction += `\n\nLƯU Ý VỀ VĂN PHONG:\n${styleInstructions}`;
  }

  if (storyContext?.page1) {
    const p1 = storyContext.page1;
    systemInstruction += `\n\nBỐI CẢNH THẾ GIỚI:
- Thể loại: ${p1.selectedGenres ? p1.selectedGenres.join(", ") : "Không có"}
- Ý tưởng chính: ${p1.prompt || "Không có"}
- Thiết lập thế giới: ${p1.worldSetting || "Không có"}`;
  }

  if (storyContext?.page2) {
    const p2 = storyContext.page2;
    systemInstruction += `\n\nNHÂN VẬT CHÍNH:
- Tên: ${p2.characterName || "Không có"}
- Danh tính: ${p2.identity || "Không có"}
- Tính cách: ${p2.personality || "Không có"}`;
  }

  let prompt = "";
  if (currentTitle?.trim()) {
    prompt += `Tên chương hiện tại để tham khảo: ${currentTitle.trim()}\n\n`;
  }

  if (previousChapters?.trim()) {
    prompt += `NGỮ CẢNH CÁC CHƯƠNG GẦN TRƯỚC:\n---\n${previousChapters}\n---\n\n`;
  }

  prompt += `NỘI DUNG CHƯƠNG CẦN ĐẶT TÊN:\n---\n${createChapterTitleExcerpt(currentStory)}\n---\n\nHãy đặt tên chương phù hợp nhất.`;

  const response = await safeGenerateContent({
    model: STABLE_FLASH_MODEL,
    contents: prompt,
    config: {
      systemInstruction,
      temperature: 0.6,
      maxOutputTokens: 128,
    },
  });

  const title = extractSingleLineTitle(response.text || "");
  if (!title) {
    throw new Error("AI không trả về tên chương hợp lệ.");
  }

  return title;
}

export async function scanStoryErrors(params: {
  currentStory: string;
  previousChapters?: string;
  styleInstructions?: string;
  storyContext?: {
    page1?: any;
    page2?: any;
    supportingCharacters?: any[];
    plotMap?: string;
  };
  writingStyles?: string[];
}) {
  const {
    currentStory,
    previousChapters,
    styleInstructions,
    storyContext,
    writingStyles,
  } = params;

  const isHanViet = writingStyles?.includes("Hán Việt");

  let systemInstruction = `Bạn là một biên tập viên chuyên nghiệp. Nhiệm vụ của bạn là phân tích đoạn văn sau và tìm ra các lỗi:
1. Lỗi chính tả và ngữ pháp.
2. Lỗi logic hoặc mâu thuẫn với thiết lập (thế giới, nhân vật, quy tắc).
3. Lỗi về tiết tấu hoặc diễn đạt.
${isHanViet ? `\nLƯU Ý VỀ PHONG CÁCH HÁN VIỆT:\n${HAN_VIET_RULES}` : ""}

YÊU CẦU ĐẦU RA:
- Trình bày dưới dạng danh sách các điểm cần lưu ý.
- Ngắn gọn, súc tích, đi thẳng vào vấn đề.
- Nếu không có lỗi, hãy trả về "Không tìm thấy lỗi đáng kể nào."
${styleInstructions ? `\nLƯU Ý VỀ VĂN PHONG:\n${styleInstructions}` : ""}
`;

  if (storyContext) {
    systemInstruction += `\n\nTHÔNG TIN BỐI CẢNH (Dùng để kiểm tra tính nhất quán):`;
    if (storyContext.page1) {
      const p1 = storyContext.page1;
      systemInstruction += `\n- Thiết lập thế giới: ${p1.worldSetting || "Không có"}`;
      if (p1.storyMemory) {
        systemInstruction += `\n- BỘ NHỚ TRUYỆN: ${p1.storyMemory}`;
      }
    }
    if (storyContext.page2) {
      const p2 = storyContext.page2;
      systemInstruction += `\n- Tên nhân vật chính: ${p2.characterName || "Không có"}`;
    }
    if (
      storyContext.supportingCharacters &&
      storyContext.supportingCharacters.length > 0
    ) {
      systemInstruction += `\n- Nhân vật phụ: ${storyContext.supportingCharacters.map((c: any) => c.name).join(", ")}`;
    }
    if (storyContext.plotMap) {
      systemInstruction += `\n- BẢN ĐỒ CỐT TRUYỆN: ${storyContext.plotMap}`;
    }
  }

  let prompt = "";
  if (previousChapters && previousChapters.trim()) {
    prompt += `NỘI DUNG CÁC CHƯƠNG TRƯỚC (Để tham khảo ngữ cảnh):\n---\n${previousChapters}\n---\n\n`;
  }
  prompt += `HÃY PHÂN TÍCH LỖI TRONG ĐOẠN VĂN SAU:\n---\n${currentStory}\n---\n`;

  const response = await safeGenerateContent({
    model: STABLE_FLASH_MODEL,
    contents: prompt,
    config: {
      systemInstruction,
      temperature: 0.2,
      maxOutputTokens: 4096,
    },
  });
  return response.text;
}
