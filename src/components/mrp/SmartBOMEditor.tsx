'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PlusCircle, Trash2, Search, Loader2, Check, Package2, Info } from 'lucide-react';
import { BillOfMaterialsItem, RawMaterial } from '@/types';
import { getRawMaterials, getMaterialsByCodes } from '@/app/admin/raw-material-management/actions';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

interface SmartBOMEditorProps {
  bom: BillOfMaterialsItem[];
  onChange: (bom: BillOfMaterialsItem[]) => void;
}

export default function SmartBOMEditor({ bom, onChange }: SmartBOMEditorProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState<RawMaterial[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [materialCache, setMaterialCache] = useState<Record<string, RawMaterial>>({});

  // Sync material cache for existing components in BOM
  useEffect(() => {
    const missingCodes = bom
      .map(item => item.component.toUpperCase())
      .filter(code => code && !materialCache[code]);

    if (missingCodes.length > 0) {
      getMaterialsByCodes(missingCodes).then(mats => {
        setMaterialCache(prev => {
          const next = { ...prev };
          mats.forEach(m => {
            next[m.code.toUpperCase()] = m;
          });
          return next;
        });
      });
    }
  }, [bom, materialCache]);

  const handleSearch = async (term: string) => {
    setSearchTerm(term);
    if (term.length < 2) {
      setSuggestions([]);
      return;
    }
    setIsSearching(true);
    try {
      const results = await getRawMaterials(term);
      setSuggestions(results);
      setMaterialCache(prev => {
        const next = { ...prev };
        results.forEach(r => {
          next[r.code.toUpperCase()] = r;
        });
        return next;
      });
    } finally {
      setIsSearching(false);
    }
  };

  const addComponent = (mat: RawMaterial) => {
    const newItem: BillOfMaterialsItem = {
      component: mat.code.toUpperCase(),
      unit: mat.unitOfMeasure as any,
      quantity: 1,
      lunghezzaTaglioMm: mat.unitOfMeasure === 'mt' ? 1000 : undefined,
      note: ''
    };
    onChange([...bom, newItem]);
    setSearchTerm('');
    setSuggestions([]);
    setMaterialCache(prev => ({ ...prev, [mat.code.toUpperCase()]: mat }));
  };

  const removeComponent = (index: number) => {
    const newBom = [...bom];
    newBom.splice(index, 1);
    onChange(newBom);
  };

  const updateItem = (index: number, updates: Partial<BillOfMaterialsItem>) => {
    const newBom = [...bom];
    newBom[index] = { ...newBom[index], ...updates };
    onChange(newBom);
  };

  const addNewRow = () => {
    const newItem: BillOfMaterialsItem = {
      component: '',
      unit: 'n',
      quantity: 1,
      lunghezzaTaglioMm: undefined,
      note: ''
    };
    onChange([...bom, newItem]);
  };

  return (
    <div className="space-y-6">
      {/* Search Header */}
      <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-800 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Search className="h-4 w-4 text-primary" />
          <Label className="text-xs font-bold uppercase tracking-wider text-slate-400">Ricerca Rapida Componenti</Label>
        </div>
        <div className="relative">
          <Input 
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Digita codice o descrizione per aggiungere..."
            className="bg-slate-950 border-slate-800 pl-4 h-10"
          />
          {isSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-primary" />}
          
          {suggestions.length > 0 && (
            <div className="absolute z-50 w-full mt-2 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl max-h-60 overflow-y-auto">
              {suggestions.map(s => (
                <div 
                  key={s.id} 
                  onClick={() => addComponent(s)}
                  className="p-3 hover:bg-primary/20 cursor-pointer border-b border-slate-700 last:border-0 transition-colors group"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-bold font-mono text-sm group-hover:text-primary transition-colors">{s.code}</span>
                    <span className="text-[10px] bg-slate-700 px-1.5 py-0.5 rounded text-slate-300 uppercase">{s.unitOfMeasure}</span>
                  </div>
                  <div className="text-xs text-slate-400 truncate mt-0.5">{s.description}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Separator className="bg-white/5" />

      {/* BOM List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between px-2">
          <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Componenti in Distinta</h4>
          <span className="text-[10px] text-primary font-bold bg-primary/10 px-2 py-0.5 rounded-full">{bom.length} Voci</span>
        </div>

        <div className="space-y-3">
          {bom.map((item, idx) => {
            const material = materialCache[item.component.toUpperCase()];
            
            return (
              <div key={idx} className="grid grid-cols-12 gap-3 p-4 bg-slate-900/30 rounded-xl border border-white/5 hover:border-primary/20 transition-all group relative">
                {/* Component Code */}
                <div className="col-span-12 md:col-span-4 space-y-1.5">
                  <div className="flex items-center justify-between h-4">
                    <Label className="text-[10px] uppercase font-bold text-slate-500">Componente</Label>
                    {material && (
                      <span className="text-[10px] text-emerald-500 flex items-center font-medium animate-in fade-in slide-in-from-right-1 truncate max-w-[200px]" title={material.description}>
                        <Check className="h-3 w-3 mr-1 shrink-0" />
                        <span className="truncate">{material.description}</span>
                      </span>
                    )}
                  </div>
                  <Input 
                    value={item.component}
                    onChange={(e) => {
                      const val = e.target.value.toUpperCase();
                      updateItem(idx, { component: val });
                    }}
                    className="bg-slate-950 border-slate-800 h-9 font-mono text-xs uppercase"
                    placeholder="CODICE..."
                  />
                </div>

                {/* Quantity */}
                <div className="col-span-4 md:col-span-2 space-y-1.5">
                  <Label className="text-[10px] uppercase font-bold text-slate-500">Q.tà per Pz</Label>
                  <Input 
                    type="number"
                    step="any"
                    value={item.quantity}
                    onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) })}
                    className="bg-slate-950 border-slate-800 h-9 text-xs"
                  />
                </div>

                {/* Cut Length */}
                <div className="col-span-4 md:col-span-2 space-y-1.5">
                  <Label className="text-[10px] uppercase font-bold text-slate-500">L. Taglio (mm)</Label>
                  <Input 
                    type="number"
                    step="any"
                    value={item.lunghezzaTaglioMm || ''}
                    onChange={(e) => updateItem(idx, { lunghezzaTaglioMm: e.target.value ? Number(e.target.value) : undefined })}
                    disabled={item.unit === 'n'}
                    className="bg-slate-950 border-slate-800 h-9 text-xs disabled:opacity-30"
                    placeholder="-"
                  />
                </div>

                {/* Notes */}
                <div className="col-span-12 md:col-span-3 space-y-1.5">
                  <Label className="text-[10px] uppercase font-bold text-slate-500">Note</Label>
                  <Input 
                    value={item.note || ''}
                    onChange={(e) => updateItem(idx, { note: e.target.value })}
                    className="bg-slate-950 border-slate-800 h-9 text-xs"
                    placeholder="..."
                  />
                </div>

                {/* Delete Button */}
                <div className="col-span-12 md:col-span-1 flex items-end justify-end pb-0.5">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => removeComponent(idx)}
                    className="h-9 w-9 text-slate-600 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* Unit Badge (Float) */}
                <div className="absolute -top-2 -left-1 opacity-0 group-hover:opacity-100 transition-opacity">
                   <Badge className="bg-slate-800 border-slate-700 text-[8px] px-1.5 h-4 uppercase">{item.unit}</Badge>
                </div>
              </div>
            );
          })}

          {bom.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-slate-800 rounded-2xl bg-slate-900/20">
              <Package2 className="h-10 w-10 text-slate-700 mb-3" />
              <p className="text-slate-500 text-sm italic">Nessun componente in distinta.</p>
              <Button 
                variant="link" 
                onClick={addNewRow}
                className="text-primary mt-2"
              >
                + Aggiungi riga manuale
              </Button>
            </div>
          )}
        </div>

        {bom.length > 0 && (
          <Button 
            variant="ghost" 
            onClick={addNewRow}
            className="w-full border border-dashed border-slate-800 hover:bg-white/5 h-10 mt-2"
          >
            <PlusCircle className="h-4 w-4 mr-2" />
            Aggiungi Riga Manuale
          </Button>
        )}
      </div>
    </div>
  );
}

function Badge({ className, children }: { className?: string, children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2", className)}>
      {children}
    </span>
  );
}
