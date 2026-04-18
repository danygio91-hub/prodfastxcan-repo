'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { 
  Palette, Layout, Type, Save, RotateCcw, Printer, FileText, 
  AlignLeft, AlignCenter, AlignRight, TableProperties, Upload, 
  Plus, Trash2, ArrowUp, ArrowDown, AlignVerticalJustifyCenter, 
  AlignVerticalJustifyStart, AlignVerticalJustifyEnd, ArrowLeft
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import ODLPrintTemplate from '@/components/production-console/ODLPrintTemplate';
import { ODLConfig, DEFAULT_ODL_CONFIG, ColumnConfig, HeaderColumnConfig } from '@/lib/odl-config';
import { getODLConfig, saveODLConfig } from '../odl-actions';
import { getGlobalSettings } from '@/lib/settings-actions';
import { useToast } from '@/hooks/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// ... MOCK DATA ...
const MOCK_JOB = {
  id: 'preview-123',
  details: 'ARTICOLO PROVIDER PROVA',
  cliente: 'CLIENTE DI TEST SPA',
  ordinePF: 'PF-2024-001',
  numeroODLInterno: 'ODL-2024-999',
  department: 'CP - CONNESSIONE PICCOLE',
  qta: 150,
  dataFinePreparazione: new Date(Date.now() - 86400000 * 5).toISOString(), // 5 days ago
  dataConsegnaFinale: new Date().toISOString(),
  billOfMaterials: [
    { component: 'TRECCIA-CO-10', quantity: 2.5, lunghezzaTaglioMm: 450, note: 'ATTENZIONE: TAGLIO A 45°' },
    { component: 'TRECCIA-CU-20', quantity: 1.2, lunghezzaTaglioMm: 300, note: '' },
    { component: 'TUBO-SIL-DN10', quantity: 1, lunghezzaTaglioMm: 0, note: 'INSERIRE BOCCOLA' },
    { component: 'GUAINA-TERM-12', quantity: 0.5, lunghezzaTaglioMm: 120 },
  ],
};

const MOCK_ARTICLE = {
  id: 'art-123',
  code: 'ARTICOLO-123',
  description: 'Descrizione articolo di prova',
  phaseTimes: {
    'phase-template-1': { expectedMinutesPerPiece: 0.5 },
    'phase-template-7': { expectedMinutesPerPiece: 0.2 },
    'phase-template-6': { expectedMinutesPerPiece: 0.3 },
  }
};

const MOCK_MATERIALS = [
  { code: 'TRECCIA-CO-10', type: 'TRECCIA', rapportoKgMt: 0.15 },
  { code: 'TRECCIA-CU-20', type: 'TRECCIA', rapportoKgMt: 0.22 },
  { code: 'TUBO-SIL-DN10', type: 'TUBI', conversionFactor: 0.05 },
  { code: 'GUAINA-TERM-12', type: 'GUAINA', conversionFactor: 0.02 },
];

const FIELD_OPTIONS = [
  { value: 'codice', label: 'Codice' },
  { value: 'lunghezzaTaglio', label: 'L. Taglio' },
  { value: 'quantita', label: 'Quantità' },
  { value: 'pesoTotale', label: 'Peso (Kg)' },
  { value: 'metriTotali', label: 'Metri' },
  { value: 'tempoPrevisto', label: 'Tempo (hh:mm)' },
  { value: 'placeholder', label: 'Verifica' },
  { value: 'checkbox', label: 'Completo (□)' },
  { value: 'note', label: 'Note BOM' },
];

const HEADER_FIELD_OPTIONS = [
    { value: 'reparto', label: 'Reparto' },
    { value: 'dataOdl', label: 'Data ODL' },
    { value: 'ordinePf', label: 'Ordine PF' },
    { value: 'numeroOdl', label: 'N° ODL' },
];

export default function ODLDesignerPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [config, setConfig] = useState<ODLConfig>(DEFAULT_ODL_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [qrRule, setQrRule] = useState<string>("{ordinePF}@{details}@{qta}");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    async function load() {
      const [savedConfig, globalSettings] = await Promise.all([
          getODLConfig(),
          getGlobalSettings()
      ]);
      
      let finalConfig = savedConfig || DEFAULT_ODL_CONFIG;

      // Migration: Ensure new fields are added to existing configs if missing
      if (finalConfig && finalConfig.info && finalConfig.info.columns) {
        // First convert any legacy dataConsegnaCliente to dataConsegnaFinale
        finalConfig.info.columns.forEach(c => {
          if (c.field === 'dataConsegnaCliente') c.field = 'dataConsegnaFinale';
        });

        const hasDelivDate = finalConfig.info.columns.some(c => c.field === 'dataConsegnaFinale');
        if (!hasDelivDate) {
          const prepDateIdx = finalConfig.info.columns.findIndex(c => c.field === 'dataFinePreparazione');
          const newCol = { id: `i${Date.now()}`, label: 'DATA CONSEGNA FINALE', field: 'dataConsegnaFinale', visible: true, colorKey: 'bgValueYellow' };
          if (prepDateIdx !== -1) {
            finalConfig.info.columns.splice(prepDateIdx + 1, 0, newCol);
          } else {
            finalConfig.info.columns.push(newCol);
          }
        }
      }

      setConfig(JSON.parse(JSON.stringify(finalConfig)));
      if (globalSettings?.jobOrderQrCodeRule) setQrRule(globalSettings.jobOrderQrCodeRule);
      setLoading(false);
    }
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const result = await saveODLConfig(config);
    if (result.success) {
      toast({ title: "Successo", description: result.message });
    } else {
      toast({ title: "Errore", description: result.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const updateConfig = (path: string, value: any) => {
    const newConfig = JSON.parse(JSON.stringify(config)); // Deep clone
    const parts = path.split('.');
    let current: any = newConfig;
    for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) current[parts[i]] = {};
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
    setConfig(newConfig);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 800000) { // Slightly higher limit for logo
        toast({ title: "Logo troppo grande", description: "Il file deve essere inferiore a 800KB.", variant: "destructive" });
        return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
        updateConfig('header.logoBase64', reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  if (!mounted || loading) return <div className="p-8 flex items-center justify-center text-blue-600 font-medium tracking-tight">Caricamento configurazione...</div>;

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden font-sans">
      {/* Sidebar Controls */}
      <div className="w-[450px] bg-white border-r shadow-xl flex flex-col h-full overflow-hidden z-10">
        <div className="p-6 border-b bg-gradient-to-r from-blue-600 to-indigo-700 flex items-center justify-between shrink-0 text-white">
          <div className="flex items-center gap-3">
            <Button 
                variant="ghost" 
                size="icon" 
                className="hover:bg-white/20 text-white mr-1" 
                onClick={() => router.back()}
                title="Torna indietro"
            >
                <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm">
                <Layout className="w-5 h-5" />
            </div>
            <h1 className="font-extrabold text-xl tracking-tight">ODL Live Designer</h1>
          </div>
          <div className="flex gap-2">
             <Button variant="ghost" size="icon" className="hover:bg-white/20 text-white" onClick={() => setConfig(DEFAULT_ODL_CONFIG)}>
                <RotateCcw className="w-4 h-4" />
             </Button>
             <Button size="sm" className="bg-white text-blue-700 hover:bg-white/90 shadow-md font-bold px-4" onClick={handleSave} disabled={saving}>
                <Save className="w-4 h-4 mr-2" />
                {saving ? 'Salvataggio...' : 'Salva'}
             </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-8 scrollbar-hide">
          <Tabs defaultValue="header" className="w-full">
            <TabsList className="grid grid-cols-5 p-1 bg-gray-100/80 rounded-xl mb-6 shadow-inner shrink-0">
              <TabsTrigger value="header" className="rounded-lg data-[state=active]:shadow-md data-[state=active]:bg-white text-[10px] font-bold">INT.</TabsTrigger>
              <TabsTrigger value="info" className="rounded-lg data-[state=active]:shadow-md data-[state=active]:bg-white text-[10px] font-bold">INFO</TabsTrigger>
              <TabsTrigger value="columns" className="rounded-lg data-[state=active]:shadow-md data-[state=active]:bg-white text-[10px] font-bold">COMP.</TabsTrigger>
              <TabsTrigger value="colors" className="rounded-lg data-[state=active]:shadow-md data-[state=active]:bg-white text-[10px] font-bold">STILE</TabsTrigger>
              <TabsTrigger value="typo" className="rounded-lg data-[state=active]:shadow-md data-[state=active]:bg-white text-[10px] font-bold">FONT</TabsTrigger>
            </TabsList>

            {/* HEADER TAB */}
            <TabsContent value="header" className="space-y-6 animate-in fade-in slide-in-from-right-2">
              <div className="space-y-4 p-5 border rounded-2xl bg-gray-50/70 shadow-sm">
                <Label className="text-sm font-bold text-gray-800 flex items-center gap-2">
                    <Type className="w-4 h-4 text-blue-600" /> Titolo Principale
                </Label>
                <Input 
                  className="rounded-lg border-gray-200 focus:ring-blue-500 shadow-sm"
                  value={config.header.title || ''} 
                  onChange={(e) => updateConfig('header.title', e.target.value)} 
                />
                <div className="grid grid-cols-2 gap-4 mt-2">
                     <div className="space-y-2 group">
                        <Label className="text-[10px] text-gray-500 uppercase font-bold tracking-tight">Colore Sfondo Cella</Label>
                        <div className="flex items-center gap-2 bg-white p-2 rounded-xl border group-hover:border-blue-500 transition-colors shadow-sm">
                            <Input type="color" className="w-8 h-8 p-0 border-none cursor-pointer shrink-0" value={config.header.titleBg || config.colors.primary} onChange={(e) => updateConfig('header.titleBg', e.target.value)} />
                            <span className="text-[10px] font-mono font-bold text-gray-400 select-all">{config.header.titleBg || config.colors.primary}</span>
                        </div>
                     </div>
                     <div className="space-y-2">
                        <Label className="text-[10px] text-gray-500 uppercase font-bold tracking-tight">Altezza Cella Titolo</Label>
                        <Input className="h-[43px] text-xs font-mono rounded-xl shadow-sm border border-gray-200" value={config.header.titleHeight || '12mm'} onChange={(e) => updateConfig('header.titleHeight', e.target.value)} placeholder="es. 12mm" />
                     </div>
                </div>
              </div>

               <div className="space-y-5 p-5 border rounded-2xl bg-gray-50/70 shadow-sm">
                  <Label className="text-sm font-bold text-gray-800 flex items-center gap-2">
                      <Printer className="w-4 h-4 text-blue-600" /> Logo & Identità
                  </Label>
                  <div className="flex items-center gap-5">
                      <div className="w-24 h-24 border-2 border-dashed border-blue-200 rounded-2xl bg-white flex items-center justify-center overflow-hidden shadow-inner group relative">
                          {config.header.logoBase64 || config.header.logoUrl ? (
                              <>
                                <img src={config.header.logoBase64 || config.header.logoUrl} alt="Logo" className="max-w-full max-h-full object-contain p-2" />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                    <Trash2 className="text-white w-6 h-6 cursor-pointer" onClick={() => updateConfig('header.logoBase64', '')} />
                                </div>
                              </>
                          ) : (
                              <Upload className="w-8 h-8 text-gray-300" />
                          )}
                      </div>
                      <div className="flex-1 space-y-3">
                          <Input id="logo-upload" type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                          <Button variant="outline" size="sm" className="w-full rounded-lg border-blue-200 text-blue-700 hover:bg-blue-50" onClick={() => document.getElementById('logo-upload')?.click()}>
                              <Upload className="w-4 h-4 mr-2" /> Carica Logo
                          </Button>
                          <p className="text-[10px] text-gray-400 text-center italic">Formati consigliati: PNG, JPG (Max 800KB)</p>
                      </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center text-xs font-semibold text-gray-600">
                        <Label>Altezza Visualizzazione Logo (px)</Label>
                        <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{config.header.logoHeight}</span>
                    </div>
                    <Slider value={[config.header.logoHeight]} min={20} max={180} step={2} onValueChange={([v]) => updateConfig('header.logoHeight', v)} className="py-2" />
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-2">
                     <div className="space-y-2 group">
                        <Label className="text-[10px] text-gray-500 uppercase font-bold tracking-tight">Colore Sfondo Cella Logo</Label>
                        <div className="flex items-center gap-2 bg-white p-2 rounded-xl border group-hover:border-blue-500 transition-colors shadow-sm">
                            <Input type="color" className="w-8 h-8 p-0 border-none cursor-pointer shrink-0" value={config.header.logoBg || '#ffffff'} onChange={(e) => updateConfig('header.logoBg', e.target.value)} />
                            <span className="text-[10px] font-mono font-bold text-gray-400 select-all">{config.header.logoBg || '#ffffff'}</span>
                        </div>
                     </div>
                     <div className="space-y-2">
                        <Label className="text-[10px] text-gray-500 uppercase font-bold tracking-tight">Larghezza Cella Logo</Label>
                        <Input className="h-[43px] text-xs font-mono rounded-xl shadow-sm border border-gray-200" value={config.header.logoColumnWidth || '23.5%'} onChange={(e) => updateConfig('header.logoColumnWidth', e.target.value)} placeholder="es. 23.5%" />
                     </div>
                  </div>
               </div>

               <div className="space-y-4 p-5 border rounded-2xl bg-gray-50/70 shadow-sm relative">
                  <div className="flex justify-between items-center mb-2">
                    <Label className="text-sm font-bold text-gray-800">Colonne Intestazione</Label>
                    <Button variant="default" size="icon" className="h-7 w-7 rounded-full bg-blue-600 shadow-lg" onClick={() => {
                        const newCols = [...(config.header.columns || [])];
                        newCols.push({ id: `hcol-${Date.now()}`, label: 'Campo', field: 'reparto', visible: true, width: '15%' });
                        updateConfig('header.columns', newCols);
                    }}>
                        <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-gray-200">
                      {config.header.columns?.map((col, idx) => (
                          <div key={col.id} className="p-3 border rounded-xl bg-white flex flex-col gap-3 shadow-sm hover:border-blue-300 transition-colors">
                              <div className="flex items-center gap-3">
                                  <Switch checked={col.visible} onCheckedChange={(val) => {
                                      const newCols = [...config.header.columns];
                                      newCols[idx] = { ...newCols[idx], visible: val };
                                      updateConfig('header.columns', newCols);
                                  }} />
                                  <Input className="h-8 text-xs font-medium flex-1 rounded-md" value={col.label} onChange={(e) => {
                                      const newCols = [...config.header.columns];
                                      newCols[idx] = { ...newCols[idx], label: e.target.value };
                                      updateConfig('header.columns', newCols);
                                  }} />
                                  <div className="flex gap-1 shrink-0">
                                      <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-400 hover:text-blue-600" onClick={() => {
                                          if (idx === 0) return;
                                          const newCols = [...config.header.columns];
                                          [newCols[idx-1], newCols[idx]] = [newCols[idx], newCols[idx-1]];
                                          updateConfig('header.columns', newCols);
                                      }}><ArrowUp className="w-4 h-4" /></Button>
                                      <Button variant="ghost" size="icon" className="h-7 w-7 text-gray-300 hover:text-red-500" onClick={() => {
                                          const newCols = config.header.columns.filter((_, i) => i !== idx);
                                          updateConfig('header.columns', newCols);
                                      }}><Trash2 className="w-4 h-4" /></Button>
                                  </div>
                              </div>
                              <div className="flex gap-2">
                                  <div className="flex-1">
                                      <Select value={col.field} onValueChange={(val) => {
                                          const newCols = [...config.header.columns];
                                          newCols[idx] = { ...newCols[idx], field: val as any };
                                          updateConfig('header.columns', newCols);
                                      }}>
                                          <SelectTrigger className="h-8 text-[11px] font-medium rounded-md">
                                              <SelectValue />
                                          </SelectTrigger>
                                          <SelectContent>
                                              {HEADER_FIELD_OPTIONS.map(opt => (
                                                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                              ))}
                                          </SelectContent>
                                      </Select>
                                  </div>
                                  <Input 
                                    className="h-8 text-xs w-20 text-center rounded-md border-gray-200" 
                                    value={col.width} 
                                    onChange={(e) => {
                                      const newCols = [...config.header.columns];
                                      newCols[idx] = { ...newCols[idx], width: e.target.value };
                                      updateConfig('header.columns', newCols);
                                    }} 
                                    placeholder="Larghezza (ex. 15%)" 
                                  />
                              </div>
                              <div className="flex items-center gap-3 px-1 mt-1">
                                  <Label className="text-[9px] font-bold text-gray-400 uppercase w-10 shrink-0">Font</Label>
                                  <Slider 
                                      value={[col.fontSize || config.typography.headerFontSize]} 
                                      min={4} max={18} step={0.5} 
                                      onValueChange={([val]) => {
                                          const newCols = [...config.header.columns];
                                          newCols[idx] = { ...newCols[idx], fontSize: val };
                                          updateConfig('header.columns', newCols);
                                      }} 
                                      className="flex-1"
                                  />
                                  <span className="text-[9px] font-mono font-bold text-blue-600 w-8">{col.fontSize || config.typography.headerFontSize}pt</span>
                              </div>
                          </div>
                      ))}
                      {(!config.header.columns || config.header.columns.length === 0) && (
                          <div className="py-8 text-center text-gray-400 italic text-sm border-2 border-dashed rounded-2xl">
                              Nessuna colonna definita. Aggiungine una!
                          </div>
                      )}
                  </div>
               </div>

              <div className="space-y-3 p-4 border rounded-2xl bg-gray-50/70 shadow-sm">
                <Label className="text-sm font-bold text-gray-800">Modulistica & Revisione</Label>
                <div className="flex items-center gap-3">
                    <Input 
                      placeholder="Codice Rev. (es. Rev. 02 del...)"
                      className="h-9 text-xs rounded-lg"
                      value={config.header.revText || ''} 
                      onChange={(e) => updateConfig('header.revText', e.target.value)} 
                    />
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-white border rounded-lg shadow-sm shrink-0">
                        <span className="text-[10px] uppercase font-bold text-gray-400">Vis.</span>
                        <Switch checked={config.header.showRevInfo} onCheckedChange={(val) => updateConfig('header.showRevInfo', val)} />
                    </div>
                </div>
              </div>

               <div className="p-4 border rounded-2xl bg-gray-50/70 shadow-sm space-y-4">
                    <div className="flex justify-between items-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                        <span>Configurazione QR Code Box</span>
                        <span className="text-blue-600 bg-white px-3 py-1 rounded-full shadow-sm">{config.header.qrSize} px</span>
                    </div>
                    <div className="px-1">
                        <Slider value={[config.header.qrSize || 65]} min={40} max={180} step={5} onValueChange={([v]) => updateConfig('header.qrSize', v)} />
                    </div>
                    <div className="grid grid-cols-3 gap-4 mt-2">
                         <div className="space-y-2 group">
                            <Label className="text-[10px] text-gray-500 uppercase font-bold tracking-tight">Colore Titolo QR</Label>
                            <div className="flex items-center gap-2 bg-white p-2 rounded-xl border group-hover:border-blue-500 transition-colors shadow-sm">
                                <Input type="color" className="w-8 h-8 p-0 border-none cursor-pointer shrink-0" value={config.header.qrTitleBg || config.colors.primary} onChange={(e) => updateConfig('header.qrTitleBg', e.target.value)} />
                                <span className="text-[10px] font-mono font-bold text-gray-400 select-all">{config.header.qrTitleBg || config.colors.primary}</span>
                            </div>
                         </div>
                         <div className="space-y-2">
                            <Label className="text-[10px] text-gray-500 uppercase font-bold tracking-tight">Altezza Cella Titolo QR</Label>
                            <Input className="h-[43px] text-xs font-mono rounded-xl shadow-sm border border-gray-200" value={config.header.qrTitleHeight || '6mm'} onChange={(e) => updateConfig('header.qrTitleHeight', e.target.value)} placeholder="es. 6mm" />
                         </div>
                         <div className="space-y-2">
                            <Label className="text-[10px] text-gray-500 uppercase font-bold tracking-tight">Larghezza Col. Destra (QR)</Label>
                            <Input className="h-[43px] text-xs font-mono rounded-xl shadow-sm border border-gray-200" value={config.header.qrColumnWidth || '15%'} onChange={(e) => updateConfig('header.qrColumnWidth', e.target.value)} placeholder="es. 15%" />
                         </div>
                    </div>
               </div>
            </TabsContent>

            {/* INFO TAB */}
            <TabsContent value="info" className="space-y-6 animate-in fade-in slide-in-from-right-2 pb-20">
                <div className="space-y-4 pt-2">
                    <Label className="text-sm font-bold tracking-tight text-gray-900 uppercase">INFORMAZIONI (AREA CENTRALE)</Label>
                    
                    <div className="grid grid-cols-2 gap-3 p-4 border rounded-2xl bg-gray-50/70 shadow-sm">
                        <div className="space-y-2">
                            <Label className="text-[10px] font-bold text-gray-400 uppercase">Larg. Etichette</Label>
                            <Input className="h-8 text-xs font-mono" value={config.info.labelWidth} onChange={(e) => updateConfig('info.labelWidth', e.target.value)} placeholder="es. 15%" />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-[10px] font-bold text-gray-400 uppercase">Larg. Valori</Label>
                            <Input className="h-8 text-xs font-mono" value={config.info.valueWidth} onChange={(e) => updateConfig('info.valueWidth', e.target.value)} placeholder="es. 25%" />
                        </div>
                        <div className="col-span-2 space-y-2">
                            <div className="flex justify-between items-center text-[10px] font-bold text-gray-400 uppercase">
                                <Label>Font Size Informazioni</Label>
                                <span className="text-blue-600">{config.info.fontSize} pt</span>
                            </div>
                            <Slider value={[config.info.fontSize]} min={4} max={18} step={0.5} onValueChange={([val]) => updateConfig('info.fontSize', val)} />
                        </div>
                    </div>

                    <div className="space-y-2">
                        {config.info.columns.map((col, idx) => (
                            <div key={col.id} className="p-3 border rounded-xl bg-white flex items-center gap-3 shadow-sm hover:border-blue-300 transition-colors">
                                <Switch checked={col.visible} onCheckedChange={(val) => {
                                    const newCols = [...config.info.columns];
                                    newCols[idx] = { ...newCols[idx], visible: val };
                                    updateConfig('info.columns', newCols);
                                }} />
                                <Input className="h-8 text-xs font-bold flex-1" value={col.label} onChange={(e) => {
                                    const newCols = [...config.info.columns];
                                    newCols[idx] = { ...newCols[idx], label: e.target.value };
                                    updateConfig('info.columns', newCols);
                                }} />
                                <Select value={col.colorKey || 'white'} onValueChange={(val) => {
                                    const newCols = [...config.info.columns];
                                    newCols[idx] = { ...newCols[idx], colorKey: val === 'white' ? undefined : val };
                                    updateConfig('info.columns', newCols);
                                }}>
                                    <SelectTrigger className="h-8 w-24 text-[10px]"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="white">Bianco</SelectItem>
                                        <SelectItem value="bgValueGreen">Verde</SelectItem>
                                        <SelectItem value="bgValueYellow">Giallo</SelectItem>
                                        <SelectItem value="bgValueRed">Rosso</SelectItem>
                                        <SelectItem value="bgValueBlue">Blu</SelectItem>
                                        <SelectItem value="bgValueGray">Grigio</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="space-y-4 p-5 border rounded-2xl bg-white shadow-xl ring-1 ring-blue-50 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 rounded-full blur-3xl -z-0"></div>
                    <div className="flex items-center justify-between relative z-10">
                      <div>
                          <Label className="font-bold text-base text-gray-800">Spazio Disegno / Note</Label>
                          <p className="text-[10px] text-gray-400 italic">Visualizza area per note manuali</p>
                      </div>
                      <Switch checked={config.layout.showDrawingArea} onCheckedChange={(val) => updateConfig('layout.showDrawingArea', val)} />
                    </div>
                    <div className="relative z-10 space-y-4">
                      <Input 
                          placeholder="Titolo area (es. DISEGNO LIBERO NC)" 
                          className="h-10 text-sm italic rounded-lg bg-gray-50/50 border-gray-200"
                          value={config.layout.drawingAreaText || ''} 
                          onChange={(e) => updateConfig('layout.drawingAreaText', e.target.value)} 
                          disabled={!config.layout.showDrawingArea} 
                      />
                      <div className="space-y-2">
                        <Label className="text-[10px] text-gray-500 uppercase font-bold tracking-tight">Altezza Area (mm)</Label>
                        <Input 
                          className="h-9 text-xs font-mono rounded-lg shadow-sm border border-gray-200" 
                          value={config.layout.drawingAreaHeight || '40mm'} 
                          onChange={(e) => updateConfig('layout.drawingAreaHeight', e.target.value)} 
                          placeholder="es. 40mm"
                          disabled={!config.layout.showDrawingArea}
                        />
                      </div>
                    </div>
                </div>

                <div className="p-4 border rounded-2xl bg-gray-50/70 shadow-sm space-y-4">
                    <div className="flex justify-between items-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                        <span>Configurazione QR Code Box</span>
                        <span className="text-blue-600 bg-white px-3 py-1 rounded-full shadow-sm">{config.header.qrSize} px</span>
                    </div>
                    <div className="px-1">
                        <Slider value={[config.header.qrSize || 65]} min={40} max={180} step={5} onValueChange={([v]) => updateConfig('header.qrSize', v)} />
                    </div>
                    <div className="grid grid-cols-3 gap-4 mt-2">
                         <div className="space-y-2 group">
                            <Label className="text-[10px] text-gray-500 uppercase font-bold tracking-tight">Colore Titolo QR</Label>
                            <div className="flex items-center gap-2 bg-white p-2 rounded-xl border group-hover:border-blue-500 transition-colors shadow-sm">
                                <Input type="color" className="w-8 h-8 p-0 border-none cursor-pointer shrink-0" value={config.header.qrTitleBg || config.colors.primary} onChange={(e) => updateConfig('header.qrTitleBg', e.target.value)} />
                                <span className="text-[10px] font-mono font-bold text-gray-400 select-all">{config.header.qrTitleBg || config.colors.primary}</span>
                            </div>
                         </div>
                         <div className="space-y-2">
                            <Label className="text-[10px] text-gray-500 uppercase font-bold tracking-tight">Altezza Titolo QR</Label>
                            <Input className="h-[43px] text-xs font-mono rounded-xl shadow-sm border border-gray-200" value={config.header.qrTitleHeight || '6mm'} onChange={(e) => updateConfig('header.qrTitleHeight', e.target.value)} placeholder="es. 6mm o 12mm" />
                         </div>
                         <div className="space-y-2">
                            <Label className="text-[10px] text-gray-500 uppercase font-bold tracking-tight">Larghezza Col. Destra</Label>
                            <Input className="h-[43px] text-xs font-mono rounded-xl shadow-sm border border-gray-200" value={config.header.qrColumnWidth || '15%'} onChange={(e) => updateConfig('header.qrColumnWidth', e.target.value)} placeholder="es. 15%" />
                         </div>
                    </div>
               </div>
            </TabsContent>

             <TabsContent value="columns" className="space-y-4 pb-20 animate-in fade-in slide-in-from-right-2">
                <div className="space-y-4 p-5 border rounded-2xl bg-gray-50/70 shadow-sm relative overflow-hidden group">
                      <div className="flex items-center justify-between">
                        <Label className="font-bold text-sm text-gray-800 uppercase italic">PREPARAZIONE COMPONENTI</Label>
                      </div>
                      <div className="flex items-center justify-between text-sm bg-white p-3 rounded-xl border group-hover:border-blue-200 transition-colors">
                        <Label className="font-medium text-xs">Includi Tempi Previsti (hh:mm)</Label>
                        <Switch checked={config.layout.showEstimatedTimes} onCheckedChange={(val) => updateConfig('layout.showEstimatedTimes', val)} />
                      </div>
                      <div className="space-y-3 pt-2">
                        <div className="flex justify-between items-center text-[10px] font-bold text-gray-400 uppercase">
                          <span>Soglia Split Pagina</span>
                          <span className="bg-blue-600 text-white px-2 py-0.5 rounded-md shadow-sm">{config.layout.splitByCategoryThreshold} righe</span>
                        </div>
                        <Slider value={[config.layout.splitByCategoryThreshold]} min={1} max={35} step={1} onValueChange={([val]) => updateConfig('layout.splitByCategoryThreshold', val)} />
                      </div>
                </div>

                <Tabs defaultValue="treccia-cols">
                    <TabsList className="grid grid-cols-3 p-1 bg-blue-50/50 rounded-xl mb-4 shrink-0">
                        <TabsTrigger value="treccia-cols" className="text-[10px] rounded-lg data-[state=active]:bg-blue-600 data-[state=active]:text-white">TRECCIA</TabsTrigger>
                        <TabsTrigger value="tubi-cols" className="text-[10px] rounded-lg data-[state=active]:bg-blue-600 data-[state=active]:text-white">TUBI</TabsTrigger>
                        <TabsTrigger value="guaina-cols" className="text-[10px] rounded-lg data-[state=active]:bg-blue-600 data-[state=active]:text-white">GUAINA</TabsTrigger>
                    </TabsList>
                    {(['treccia', 'tubi', 'guaina'] as const).map(cat => (
                        <TabsContent key={cat} value={`${cat}-cols`} className="space-y-3">
                            <div className="text-[9px] font-black text-gray-400 uppercase flex gap-2 px-2 items-center tracking-widest leading-none">
                                <span className="w-8 shrink-0">VIS.</span>
                                <span className="flex-1">ETICHETTA HEADER</span>
                                <span className="w-24 shrink-0">SORGENTE DATO</span>
                                <span className="w-12 shrink-0">W %</span>
                                <span className="w-16 shrink-0">ALLIN.</span>
                            </div>
                            {config.columns?.[cat]?.map((col, idx) => (
                                <div key={col.id} className="p-3 border rounded-2xl bg-white flex flex-col gap-3 shadow-md border-gray-100 hover:border-blue-400 transition-all hover:shadow-lg">
                                    <div className="flex items-center gap-3">
                                        <Switch 
                                            checked={col.visible} 
                                            onCheckedChange={(val) => {
                                                const newCols = [...config.columns[cat]];
                                                newCols[idx] = { ...newCols[idx], visible: val };
                                                updateConfig(`columns.${cat}`, newCols);
                                            }}
                                        />
                                        <Input 
                                            className="h-8 text-xs font-bold text-blue-900 bg-blue-50/20 rounded-lg border-blue-100 flex-1" 
                                            value={col.label} 
                                            onChange={(e) => {
                                                const newCols = [...config.columns[cat]];
                                                newCols[idx] = { ...newCols[idx], label: e.target.value };
                                                updateConfig(`columns.${cat}`, newCols);
                                            }}
                                        />
                                        <div className="flex gap-1 shrink-0 bg-gray-50 p-1 rounded-lg">
                                            <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400 hover:bg-white hover:shadow-sm transition-all" onClick={() => {
                                                if (idx === 0) return;
                                                const newCols = [...config.columns[cat]];
                                                [newCols[idx-1], newCols[idx]] = [newCols[idx], newCols[idx-1]];
                                                updateConfig(`columns.${cat}`, newCols);
                                            }}><ArrowUp className="w-3 h-3" /></Button>
                                            <Button variant="ghost" size="icon" className="h-6 w-6 text-red-300 hover:bg-white hover:text-red-600 hover:shadow-sm transition-all" onClick={() => {
                                                const newCols = config.columns[cat].filter((_, i) => i !== idx);
                                                updateConfig(`columns.${cat}`, newCols);
                                            }}><Trash2 className="w-3 h-3" /></Button>
                                        </div>
                                    </div>
                                    <div className="flex gap-2 items-center">
                                        <div className="flex-1">
                                            <Select 
                                                value={col.field}
                                                onValueChange={(val) => {
                                                    const newCols = [...config.columns[cat]];
                                                    newCols[idx] = { ...newCols[idx], field: val };
                                                    updateConfig(`columns.${cat}`, newCols);
                                                }}
                                            >
                                                <SelectTrigger className="h-8 text-[11px] font-semibold bg-gray-50 border-gray-200">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {FIELD_OPTIONS.map(opt => (
                                                        <SelectItem key={opt.value} value={opt.value} className="text-[11px]">
                                                            {opt.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <Input 
                                            className="h-8 text-xs w-14 shrink-0 text-center font-mono border-gray-200" 
                                            value={col.width} 
                                            onChange={(e) => {
                                                const newCols = [...config.columns[cat]];
                                                newCols[idx] = { ...newCols[idx], width: e.target.value };
                                                updateConfig(`columns.${cat}`, newCols);
                                            }}
                                        />
                                        <div className="flex gap-0 px-1 bg-gray-100 rounded-lg p-0.5 shrink-0 border border-gray-200">
                                            <Button variant={col.textAlign === 'left' ? 'secondary' : 'ghost'} className="h-7 w-7 p-0 rounded-md data-[variant=secondary]:bg-white data-[variant=secondary]:shadow-sm" onClick={() => {
                                                const newCols = [...config.columns[cat]];
                                                newCols[idx] = { ...newCols[idx], textAlign: 'left' };
                                                updateConfig(`columns.${cat}`, newCols);
                                            }}><AlignLeft className="w-3.5 h-3.5" /></Button>
                                            <Button variant={col.textAlign === 'center' ? 'secondary' : 'ghost'} className="h-7 w-7 p-0 rounded-md data-[variant=secondary]:bg-white data-[variant=secondary]:shadow-sm" onClick={() => {
                                                const newCols = [...config.columns[cat]];
                                                newCols[idx] = { ...newCols[idx], textAlign: 'center' };
                                                updateConfig(`columns.${cat}`, newCols);
                                            }}><AlignCenter className="w-3.5 h-3.5" /></Button>
                                            <Button variant={col.textAlign === 'right' ? 'secondary' : 'ghost'} className="h-7 w-7 p-0 rounded-md data-[variant=secondary]:bg-white data-[variant=secondary]:shadow-sm" onClick={() => {
                                                const newCols = [...config.columns[cat]];
                                                newCols[idx] = { ...newCols[idx], textAlign: 'right' };
                                                updateConfig(`columns.${cat}`, newCols);
                                            }}><AlignRight className="w-3.5 h-3.5" /></Button>
                                        </div>
                                    </div>
                                    {/* Font Size Control for Column */}
                                    <div className="flex items-center gap-3 px-1">
                                        <Label className="text-[10px] font-bold text-gray-400 uppercase w-12 shrink-0">Font Size</Label>
                                        <Slider 
                                            value={[col.fontSize || config.typography.baseFontSize]} 
                                            min={4} max={16} step={0.5} 
                                            onValueChange={([val]) => {
                                                const newCols = [...config.columns[cat]];
                                                newCols[idx] = { ...newCols[idx], fontSize: val };
                                                updateConfig(`columns.${cat}`, newCols);
                                            }} 
                                            className="flex-1"
                                        />
                                        <span className="text-[10px] font-mono font-bold text-blue-600 w-8">{col.fontSize || config.typography.baseFontSize}pt</span>
                                    </div>
                                </div>
                            ))}
                        </TabsContent>
                    ))}
                </Tabs>
             </TabsContent>

            {/* COLORS TAB */}
            <TabsContent value="colors" className="space-y-6 animate-in fade-in slide-in-from-right-2 pb-20">
              <div className="space-y-4 p-5 border rounded-2xl bg-gray-50/70 shadow-sm">
                  <Label className="text-sm font-bold text-gray-800 flex items-center gap-2 mb-2">
                       <Layout className="w-4 h-4 text-blue-600" /> Documento & Struttura
                  </Label>
                  <div className="grid grid-cols-2 gap-5">
                    <div className="space-y-2 group">
                      <Label className="text-[11px] font-bold text-gray-500 uppercase tracking-tighter">Color Brand</Label>
                      <div className="flex items-center gap-2 bg-white p-2 rounded-xl border group-hover:border-blue-500 transition-colors shadow-sm">
                        <Input type="color" className="w-10 h-10 p-0 border-none cursor-pointer shrink-0" value={config.colors.primary} onChange={(e) => updateConfig('colors.primary', e.target.value)} />
                        <span className="text-xs font-mono font-bold text-gray-400 select-all">{config.colors.primary}</span>
                      </div>
                    </div>
                    <div className="space-y-2 group">
                      <Label className="text-[11px] font-bold text-gray-500 uppercase tracking-tighter">Griglia (Bordi)</Label>
                      <div className="flex items-center gap-2 bg-white p-2 rounded-xl border group-hover:border-blue-500 transition-colors shadow-sm">
                        <Input type="color" className="w-10 h-10 p-0 border-none cursor-pointer shrink-0" value={config.colors.border} onChange={(e) => updateConfig('colors.border', e.target.value)} />
                        <span className="text-xs font-mono font-bold text-gray-400 select-all">{config.colors.border}</span>
                      </div>
                    </div>
                  </div>
              </div>

              <div className="space-y-5 p-5 border rounded-2xl bg-gray-50/70 shadow-sm relative overflow-hidden">
                  <div className="absolute -bottom-8 -right-8 w-24 h-24 bg-blue-100/50 rounded-full blur-2xl"></div>
                  <Label className="text-sm font-bold text-gray-800 flex items-center gap-2 relative z-10">
                      <Palette className="w-4 h-4 text-blue-600" /> Layered Color Gradients
                  </Label>
                  <div className="space-y-4 relative z-10">
                      {/* Header Section */}
                      <div className="p-4 border rounded-xl bg-white space-y-3 shadow-inner border-blue-50">
                          <div className="flex justify-between items-center">
                              <Label className="text-[11px] font-black uppercase text-blue-900/40">Intestazione (Header)</Label>
                              <div className="w-8 h-1 rounded-full bg-blue-200"></div>
                          </div>
                          <div className="grid grid-cols-2 gap-5">
                              <div className="space-y-2">
                                  <Label className="text-[10px] text-gray-400">Backdrop</Label>
                                  <Input type="color" value={config.colors.headerBg} onChange={(e) => updateConfig('colors.headerBg', e.target.value)} className="h-9 w-full shadow-sm rounded-lg" />
                              </div>
                              <div className="space-y-2">
                                  <Label className="text-[10px] text-gray-400">Testo Header</Label>
                                  <Input type="color" value={config.colors.headerText} onChange={(e) => updateConfig('colors.headerText', e.target.value)} className="h-9 w-full shadow-sm rounded-lg" />
                              </div>
                          </div>
                      </div>
                      
                      {/* Tables Section Header */}
                      <div className="p-4 border rounded-xl bg-white space-y-3 shadow-inner border-gray-100">
                          <Label className="text-[11px] font-black uppercase text-gray-900/40">Intestazione Tabelle</Label>
                          <div className="grid grid-cols-2 gap-5">
                              <div className="space-y-2">
                                  <Label className="text-[10px] text-gray-400">Backdrop</Label>
                                  <Input type="color" value={config.colors.tableHeaderBg} onChange={(e) => updateConfig('colors.tableHeaderBg', e.target.value)} className="h-9 w-full shadow-sm" />
                              </div>
                              <div className="space-y-2">
                                  <Label className="text-[10px] text-gray-400">Testo Header</Label>
                                  <Input type="color" value={config.colors.tableHeaderText} onChange={(e) => updateConfig('colors.tableHeaderText', e.target.value)} className="h-9 w-full shadow-sm" />
                              </div>
                          </div>
                      </div>

                      {/* Footer Section */}
                      <div className="p-4 border rounded-xl bg-white space-y-3 shadow-inner border-gray-100">
                          <Label className="text-[11px] font-black uppercase text-gray-900/40">Piè di Pagina (Footer)</Label>
                          <div className="grid grid-cols-2 gap-5">
                              <div className="space-y-2">
                                  <Label className="text-[10px] text-gray-400">Backdrop</Label>
                                  <Input type="color" value={config.colors.footerBg} onChange={(e) => updateConfig('colors.footerBg', e.target.value)} className="h-9 w-full shadow-sm" />
                              </div>
                              <div className="space-y-2">
                                  <Label className="text-[10px] text-gray-400">Testo Note</Label>
                                  <Input type="color" value={config.colors.footerText} onChange={(e) => updateConfig('colors.footerText', e.target.value)} className="h-9 w-full shadow-sm" />
                              </div>
                          </div>
                      </div>
                  </div>
              </div>

               <div className="space-y-4 p-5 border rounded-2xl bg-gray-50/70 shadow-sm border-dashed border-blue-300">
                  <Label className="text-sm font-black text-blue-800 uppercase italic">Sfondi Campi Informazioni</Label>
                  <div className="grid grid-cols-5 gap-3">
                     {[
                        { key: 'bgValueGreen', label: 'Verde' },
                        { key: 'bgValueYellow', label: 'Giallo' },
                        { key: 'bgValueRed', label: 'Rosso' },
                        { key: 'bgValueBlue', label: 'Blu' },
                        { key: 'bgValueGray', label: 'Grigio' },
                     ].map((c) => (
                        <div key={c.key} className="flex flex-col items-center gap-2 group">
                           <Input type="color" className="w-10 h-10 shadow-md rounded-full overflow-hidden border-2 border-white cursor-pointer" value={(config.colors as any)[c.key]} onChange={(e) => updateConfig(`colors.${c.key}`, e.target.value)} />
                           <span className="text-[9px] font-bold text-gray-500 uppercase">{c.label}</span>
                        </div>
                     ))}
                  </div>
               </div>
              
              <div className="space-y-4 p-5 border rounded-2xl bg-gray-50/70 shadow-sm border-dashed border-gray-300">
                 <Label className="text-sm font-black text-gray-800 uppercase italic">Row Highlighting (Categories)</Label>
                 <div className="grid grid-cols-3 gap-4">
                    <div className="flex flex-col items-center gap-2 group">
                       <Input type="color" className="w-12 h-12 shadow-lg rounded-full overflow-hidden border-2 border-white group-hover:scale-110 transition-transform" value={config.colors.bgTreccia} onChange={(e) => updateConfig('colors.bgTreccia', e.target.value)} />
                       <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tight">Treccia</span>
                    </div>
                    <div className="flex flex-col items-center gap-2 group">
                       <Input type="color" className="w-12 h-12 shadow-lg rounded-full overflow-hidden border-2 border-white group-hover:scale-110 transition-transform" value={config.colors.bgTubi} onChange={(e) => updateConfig('colors.bgTubi', e.target.value)} />
                       <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tight">Tubi</span>
                    </div>
                    <div className="flex flex-col items-center gap-2 group">
                       <Input type="color" className="w-12 h-12 shadow-lg rounded-full overflow-hidden border-2 border-white group-hover:scale-110 transition-transform" value={config.colors.bgGuaina} onChange={(e) => updateConfig('colors.bgGuaina', e.target.value)} />
                       <span className="text-[10px] font-bold text-gray-500 uppercase tracking-tight">Guaina</span>
                    </div>
                 </div>
              </div>
            </TabsContent>

            {/* TYPOGRAPHY TAB */}
            <TabsContent value="typo" className="space-y-6 animate-in fade-in slide-in-from-right-2">
               <div className="space-y-8 p-6 border rounded-3xl bg-white shadow-2xl ring-1 ring-blue-50">
                  <div className="space-y-4">
                    <div className="flex justify-between items-center bg-gray-50 p-3 rounded-2xl border border-dotted">
                        <Label className="font-bold text-gray-700">Dimensione Base Celle</Label>
                        <span className="bg-blue-600 text-white font-mono text-xs px-3 py-1 rounded-full shadow-md font-bold">{config.typography.baseFontSize} pt</span>
                    </div>
                    <Slider value={[config.typography.baseFontSize]} min={5} max={14} step={0.5} onValueChange={([val]) => updateConfig('typography.baseFontSize', val)} className="mt-2" />
                  </div>
                  
                  <div className="space-y-4">
                    <div className="flex justify-between items-center bg-gray-50 p-3 rounded-2xl border border-dotted">
                        <Label className="font-bold text-gray-700">Titolo Documento</Label>
                        <span className="bg-indigo-600 text-white font-mono text-xs px-3 py-1 rounded-full shadow-md font-bold">{config.typography.titleFontSize} pt</span>
                    </div>
                    <Slider value={[config.typography.titleFontSize]} min={10} max={24} step={1} onValueChange={([val]) => updateConfig('typography.titleFontSize', val)} className="mt-2" />
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-center bg-gray-50 p-3 rounded-2xl border border-dotted">
                        <Label className="font-bold text-gray-700">Intestazioni (Header Labels)</Label>
                        <span className="bg-purple-600 text-white font-mono text-xs px-3 py-1 rounded-full shadow-md font-bold">{config.typography.headerFontSize} pt</span>
                    </div>
                    <Slider value={[config.typography.headerFontSize]} min={4} max={12} step={0.5} onValueChange={([val]) => updateConfig('typography.headerFontSize', val)} className="mt-2" />
                  </div>
                  
                  <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100 flex gap-4">
                      <div className="w-1 bg-blue-400 rounded-full"></div>
                      <p className="text-[10px] text-blue-800 leading-relaxed italic">
                          "I font della tipografia sono ottimizzati per la massima leggibilità in stampa PDF A4 Orizzontale."
                      </p>
                  </div>
               </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Main Preview Area */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-100/50 relative">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-purple-600 blur-sm z-50"></div>
        <div className="h-14 border-b bg-white flex items-center px-6 justify-between shrink-0 shadow-sm z-40">
          <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <div className="text-sm text-gray-800 font-extrabold tracking-tight uppercase">Real-Time PDF Preview (A4 Orizzontale)</div>
          </div>
          <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-[10px] text-blue-600 font-black bg-blue-50 px-3 py-1.5 rounded-full border border-blue-100 shadow-sm">
                 <Printer className="w-3.5 h-3.5" />
                 OTTIMIZZATO PER STAMPA 1:1
              </div>
          </div>
        </div>
        
        <div className="flex-1 overflow-auto p-12 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent">
           <div className="mx-auto bg-white shadow-[0_35px_60px_-15px_rgba(0,0,0,0.3)] origin-top transition-all duration-500 rounded-sm overflow-hidden" style={{ width: '297mm' }}>
              <ODLPrintTemplate 
                job={MOCK_JOB as any} 
                article={MOCK_ARTICLE as any} 
                materials={MOCK_MATERIALS as any} 
                config={config} 
                qrRule={qrRule}
              />
           </div>
           
           {/* Mock Pagination Indicator */}
           <div className="mt-10 mx-auto w-[297mm] flex justify-center pb-20">
               <div className="flex gap-1.5 p-2 bg-gray-200/50 backdrop-blur-md rounded-2xl shadow-inner border border-white">
                   <div className="w-8 h-8 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold shadow-lg">1</div>
                   <div className="w-8 h-8 rounded-xl bg-white text-gray-400 flex items-center justify-center font-bold border border-gray-100 italic text-[10px]">...next</div>
               </div>
           </div>
        </div>
      </div>
    </div>
  );
}
