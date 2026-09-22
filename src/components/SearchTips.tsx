import React, { useState } from "react";
import { Lightbulb, X, MessageSquare, Radio, Sparkles, MapPin, Briefcase, HelpCircle, ArrowRight } from "lucide-react";

interface SearchTipsProps {
  onSelectQuery?: (query: string) => void;
}

export default function SearchTips({ onSelectQuery }: SearchTipsProps) {
  const [isOpen, setIsOpen] = useState(false);

  const sampleGroups = [
    {
      category: "💬 Чаты и сообщества (для общения и лидгена)",
      icon: <MessageSquare className="w-4 h-4 text-emerald-400" />,
      description: "Каталоги ищут по совпадению в названии и описании. Добавляйте маркеры диалога:",
      keywords: ["чат", "беседа", "group", "talk", "обсуждаем", "флудилка", "нетворкинг", "комьюнити"],
      templates: [
        "IT вакансии чат",
        "Крипта нетворкинг чат",
        "Недвижимость Дубай чат",
        "Стартапы фаундеры чат",
        "Релокация Сербия чат",
      ],
    },
    {
      category: "📢 Тематические каналы и блоги",
      icon: <Radio className="w-4 h-4 text-blue-400" />,
      description: "Для поиска авторских блогов и медиа используйте предметные маркеры:",
      keywords: ["новости", "блог", "дайджест", "канал", "аналитика", "обзоры"],
      templates: [
        "Нейросети AI новости",
        "Маркетинг и трафик",
        "Финансы инвестиции канал",
        "E-commerce маркетплейсы",
      ],
    },
    {
      category: "🌍 Гео и локальные чаты экспатов",
      icon: <MapPin className="w-4 h-4 text-amber-400" />,
      description: "Сочетайте название локации с типом сообщества:",
      keywords: ["город + чат", "страна + экспаты", "район + барахолка"],
      templates: [
        "Пхукет чат экспаты",
        "Бали аренда жилья чат",
        "Тбилиси взаимопомощь чат",
        "Дубай бизнес нетворкинг",
      ],
    },
    {
      category: "💼 Работа, фриланс и заказы",
      icon: <Briefcase className="w-4 h-4 text-purple-400" />,
      description: "Ищите целевые биржи и каналы с предложениями о работе:",
      keywords: ["вакансии", "резюме", "фриланс", "работа", "заказы"],
      templates: [
        "Python вакансии удаленка",
        "Дизайн фриланс заказы чат",
        "Менеджер проектов работа",
      ],
    },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
        title="Как лучше писать запросы"
      >
        <Lightbulb className="w-3.5 h-3.5" />
        <span>Подсказки к запросам</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl bg-[#12151C] border border-slate-700/80 shadow-2xl overflow-hidden text-slate-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#0E1017]">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-white">Как составить эффективный запрос</h3>
                  <p className="text-xs text-slate-400">Советы по поиску чатов, каналов и групп в Telegram</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 text-xs text-slate-300">
              {/* Important rule 1: Multi-query */}
              <div className="p-3.5 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <div className="font-semibold text-blue-300 text-sm mb-1">
                  ⚡ Поиск по нескольким запросам сразу
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Вы можете перечислить несколько запросов через запятую, например:{" "}
                  <code className="px-1.5 py-0.5 rounded bg-blue-950 text-blue-200 font-mono">
                    крипта чат, it вакансии, пхукет экспаты
                  </code>
                  . Система последовательно опросит все каталоги по каждому запросу и автоматически исключит дубликаты.
                </p>
              </div>

              {/* Important rule 2: Global DB acceleration */}
              <div className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <div className="font-semibold text-emerald-300 text-sm mb-1">
                  💾 Глобальная база и ускорение
                </div>
                <p className="text-slate-300 leading-relaxed">
                  Все найденные каналы и чаты (название, описание, ссылка, аватар, количество участников) автоматически сохраняются в общую базу данных. При повторном поиске совпадения подгружаются мгновенно!
                </p>
              </div>

              {/* Categories & Templates */}
              <div className="space-y-4">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Рекомендации по категориям (нажмите на пример для подстановки):
                </div>

                {sampleGroups.map((group, idx) => (
                  <div key={idx} className="p-4 rounded-lg bg-[#181C26] border border-slate-800/80 space-y-2.5">
                    <div className="flex items-center gap-2 font-medium text-slate-100">
                      {group.icon}
                      <span>{group.category}</span>
                    </div>
                    <p className="text-slate-400 leading-relaxed">{group.description}</p>
                    
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[11px] text-slate-500 self-center mr-1">Ключи:</span>
                      {group.keywords.map((kw, kidx) => (
                        <span key={kidx} className="px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700/60 font-mono text-[11px] text-slate-300">
                          {kw}
                        </span>
                      ))}
                    </div>

                    <div className="pt-1 flex flex-wrap gap-1.5 items-center">
                      <span className="text-[11px] text-slate-500 mr-1">Примеры:</span>
                      {group.templates.map((tpl, tidx) => (
                        <button
                          key={tidx}
                          type="button"
                          onClick={() => {
                            if (onSelectQuery) {
                              onSelectQuery(tpl);
                            }
                            setIsOpen(false);
                          }}
                          className="group inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800/50 hover:bg-blue-600/20 border border-slate-700/60 hover:border-blue-500/40 text-blue-300 transition-colors text-[11px]"
                        >
                          <span>{tpl}</span>
                          <ArrowRight className="w-2.5 h-2.5 text-blue-400 group-hover:translate-x-0.5 transition-transform" />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-slate-800 bg-[#0E1017] flex justify-end">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
              >
                Понятно, закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
