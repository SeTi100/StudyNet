import sys
import os
import argparse
from pathlib import Path

# Note: Requires docling to be installed (pip install docling)
try:
    from docling.document_converter import DocumentConverter
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import PdfFormatOption
except ImportError:
    print("Error: docling is not installed. Please run 'pip install docling'")
    sys.exit(1)

def main():
    parser = argparse.ArgumentParser(description="Convert PDF to Markdown using Docling")
    parser.add_argument("input_pdf", help="Path to the input PDF file")
    parser.add_argument("output_md", help="Path to the output Markdown file")
    parser.add_argument("image_dir", help="Directory to save extracted images")
    args = parser.parse_args()

    input_path = Path(args.input_pdf)
    output_path = Path(args.output_md)
    image_dir = Path(args.image_dir)

    if not input_path.exists():
        print(f"Error: Input file {input_path} does not exist.")
        sys.exit(1)

    os.makedirs(image_dir, exist_ok=True)
    os.makedirs(output_path.parent, exist_ok=True)

    import warnings
    warnings.filterwarnings("ignore", category=UserWarning, module="torch.nn.modules.conv")
    
    print(f"Starting Docling conversion for {input_path}...")

    # Configure pipeline to extract images in high resolution and transcribe formulas with CodeFormula model
    pipeline_options = PdfPipelineOptions()
    pipeline_options.generate_picture_images = True
    pipeline_options.images_scale = 2.5  # High-res image extraction (2.5x standard 72 DPI -> ~180 DPI)
    pipeline_options.do_table_structure = True
    pipeline_options.generate_page_images = True
    pipeline_options.do_formula_enrichment = False  # Disabled because it takes 15m on CPU and hallucinates
    
    doc_converter = DocumentConverter(
        allowed_formats=[InputFormat.PDF],
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
        }
    )

    try:
        from docling_core.types.doc.base import ImageRefMode
    except ImportError:
        ImageRefMode = None

    try:
        conv_result = doc_converter.convert(input_path)
        
        # Fallback: Extract formula images since OCR text is missing and VLM is disabled
        import uuid
        for item, level in conv_result.document.iterate_items():
            if getattr(item, 'label', '') == 'formula':
                try:
                    img = item.get_image(conv_result.document)
                    if img:
                        f_name = f"formula-{uuid.uuid4().hex[:8]}.png"
                        f_path = image_dir / f_name
                        img.save(f_path)
                        item.text = f"![Formula](images/{f_name})"
                except Exception as e:
                    print(f"Warning extracting formula image: {e}")
                    item.text = "" # Prevent ugly HTML comment if completely empty
        try:
            if ImageRefMode:
                conv_result.document.save_as_markdown(output_path, artifacts_dir=image_dir, image_mode=ImageRefMode.REFERENCED)
            else:
                conv_result.document.save_as_markdown(output_path, artifacts_dir=image_dir)
        except Exception as save_err:
            print(f"Warning on save_as_markdown with artifacts_dir: {save_err}, fallback to export_to_markdown")
            md_text = conv_result.document.export_to_markdown()
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(md_text)

        # Save complete semantic JSON structure model
        try:
            json_path = output_path.with_suffix('.json')
            conv_result.document.save_as_json(json_path)
            print(f"Saved structure JSON to {json_path}")
        except Exception as json_err:
            print(f"Warning saving document JSON: {json_err}")
            
        # Post-process Markdown: fix ligatures, normalize images, stitch split paragraphs
        try:
            with open(output_path, "r", encoding="utf-8") as f:
                raw_md = f.read()

            import re
            
            # 1. Fix typographic ligature splits (e.g. 'signi fi cance' -> 'significance', 'e ffi ciency' -> 'efficiency')
            def fix_ligatures(text):
                # Standalone ligature tokens in middle of words: 'signi fi cance' -> 'significance', 'e ffi ciency' -> 'efficiency'
                text = re.sub(r'\b([a-zA-Z]+)\s+(ffi|ffl|fi|fl|ff)\s+([a-zA-Z]+)\b', r'\1\2\3', text)
                # Standalone ligature tokens at start of words: 'fi gure' -> 'figure', 'fl uid' -> 'fluid'
                text = re.sub(r'\b(ffi|ffl|fi|fl)\s+([a-zA-Z]{2,})\b', r'\1\2', text)
                # Standalone ligature tokens at end of words
                text = re.sub(r'\b([a-zA-Z]{2,})\s+(ffi|ffl|fi|fl)\b(?!\s+(?:and|or|of|in|to|the|a|an|is|are|was|were|for|with|by|on|at|from))', r'\1\2', text)
                return text

            clean_md = fix_ligatures(raw_md)

            # 2. Normalize image paths
            def normalize_img_ref(match):
                alt = match.group(1)
                raw_url = match.group(2)
                filename = Path(raw_url.replace("\\", "/")).name
                return f"![{alt}](images/{filename})"

            clean_md = re.sub(r'!\[([^\]]*)\]\(([^)]+\.(?:png|jpg|jpeg|webp|svg|gif))\)', normalize_img_ref, clean_md, flags=re.IGNORECASE)
            
            # 2b. Strip $$ wrappers around our fallback formula images
            clean_md = re.sub(r'\$\$\s*(!\[Formula\]\([^)]+\))\s*\$\$', r'\1', clean_md)
            
            # Remove page footers/headers (e.g., 102 \n Catalysis Today...)
            clean_md = re.sub(r'(?m)^\s*\d+\s*\n\s*Catalysis Today[^\n]*\n?', '', clean_md)
            clean_md = re.sub(r'(?m)^\s*Catalysis Today[^\n]*\n\s*\d+\s*\n?', '', clean_md)

            # 3. Stitch paragraphs split across pages, figures, and formulas
            def stitch_paragraphs(md_text):
                blocks = re.split(r'\n{2,}', md_text.strip())
                new_blocks = []
                open_paragraph = None
                intervening_blocks = []
                
                for block in blocks:
                    block = block.strip()
                    if not block:
                        continue
                        
                    is_caption = bool(re.match(r'^(?:Fig(?:ure)?\.?|Table|Scheme|Chart|Box)\b', block, re.IGNORECASE))
                    is_special = block.startswith('![') or block.startswith('#') or block.startswith('|') or block.startswith('<') or block.startswith('$$') or block.startswith('$') or is_caption
                    
                    if open_paragraph is not None:
                        # We are looking for the continuation
                        if not is_special and re.match(r'^[a-z]', block):
                            if open_paragraph.endswith('-'):
                                # Only strip hyphen if it looks like a soft word break (preceded by TWO lowercase letters)
                                # This prevents stripping hard hyphens in chemical formulas like "Cu-"
                                if len(open_paragraph) > 2 and open_paragraph[-2].islower() and open_paragraph[-3].islower():
                                    open_paragraph = open_paragraph[:-1] + block
                                else:
                                    open_paragraph = open_paragraph + block
                            else:
                                open_paragraph = open_paragraph + " " + block
                            
                            # Check if it's now closed
                            if re.search(r'[.!?:"\']$', open_paragraph):
                                new_blocks.append(open_paragraph)
                                new_blocks.extend(intervening_blocks)
                                open_paragraph = None
                                intervening_blocks = []
                            continue
                        elif not is_special and re.match(r'^[A-Z]', block) and len(block.split()) > 5:
                            # We hit a new normal text paragraph (starts with Capital, >5 words)
                            # The previous paragraph must have ended without punctuation. Flush it.
                            new_blocks.append(open_paragraph)
                            new_blocks.extend(intervening_blocks)
                            open_paragraph = None
                            intervening_blocks = []
                            
                            # Re-evaluate this new block to see if it is open
                            if re.search(r'[a-zA-Z0-9,\-]$', block):
                                open_paragraph = block
                                intervening_blocks = []
                                continue
                            else:
                                new_blocks.append(block)
                                continue
                        else:
                            intervening_blocks.append(block)
                            # Abandon stitching if we hit a hard structural break or too many intervening blocks
                            if block.startswith('#') or block.startswith('|') or len(intervening_blocks) > 25:
                                new_blocks.append(open_paragraph)
                                new_blocks.extend(intervening_blocks)
                                open_paragraph = None
                                intervening_blocks = []
                    else:
                        # Check if this block is a text paragraph that ends abruptly
                        if not is_special and re.search(r'[a-zA-Z0-9,\-]$', block) and not block.isdigit():
                            if len(block.split()) > 5:
                                open_paragraph = block
                                intervening_blocks = []
                                continue
                        
                        new_blocks.append(block)
                        
                if open_paragraph is not None:
                    new_blocks.append(open_paragraph)
                    new_blocks.extend(intervening_blocks)
                    
                return '\n\n'.join(new_blocks)

            stitched_md = stitch_paragraphs(clean_md)
            
            def sanitize_latex(text):
                # Fix hallucinated repetitive \intertext blocks
                text = re.sub(r'(\\intertext\s*\{\s*c\s*o\s*n\s*t\s*i\s*t\s*i\s*o\s*n\s*\}\s*\\quad\s*)+', '', text)
                text = re.sub(r'(\\intertext\s*\{\s*c\s*o\s*n\s*t\s*i\s*t\s*i\s*o\s*n\s*\})', '', text)
                
                # Fix hallucinated infinite alignment arrays
                text = re.sub(r'\\begin\{array\}\{([clr]\s*){5,}\}', r'\\begin{array}{c}', text)
                
                # Fix repetitive 'c c c' output
                text = re.sub(r'(c\s+){10,}c?', '', text)
                
                return text

            def fix_scrambled_equations(text, pdf_path):
                import fitz
                try:
                    doc = fitz.open(pdf_path)
                    eq_map = {}
                    
                    for page in doc:
                        blocks = page.get_text('blocks')
                        words = page.get_text('words')
                        for b in blocks:
                            b_text = b[4]
                            # Check if block has equation indicators (short block with arrows or numbers)
                            if ('→' in b_text or '->' in b_text or 'υ' in b_text or '•' in b_text) and len(b_text) < 180:
                                m_label = re.search(r'\(\s*\d+\s*[a-zA-Z]?\s*\)', b_text)
                                if m_label:
                                    label = re.sub(r'\s+', '', m_label.group(0))
                                    # Sort words horizontally within this block
                                    b_words = [w for w in words if w[0] >= b[0]-2 and w[1] >= b[1]-2 and w[2] <= b[2]+2 and w[3] <= b[3]+2]
                                    lines = {}
                                    for w in b_words:
                                        y_mid = (w[1] + w[3]) / 2
                                        matched_y = None
                                        for y in lines:
                                            if abs(y - y_mid) < 4:
                                                matched_y = y
                                                break
                                        if matched_y is None:
                                            matched_y = y_mid
                                            lines[matched_y] = []
                                        lines[matched_y].append(w)
                                    
                                    line_strs = []
                                    for y in sorted(lines.keys()):
                                        l_sorted = sorted(lines[y], key=lambda w: w[0])
                                        l_str = ' '.join(w[4] for w in l_sorted)
                                        l_str = re.sub(r'\s+', ' ', l_str).strip()
                                        line_strs.append(l_str)
                                    
                                    clean_res = ' '.join(line_strs)
                                    if '→' in clean_res or '->' in clean_res:
                                        eq_map[label] = clean_res
                                        
                    if not eq_map:
                        return text

                    # Check for grouped sub-equations like (4a)-(4g)
                    grouped_4 = []
                    for sub in ['a', 'b', 'c', 'd', 'e', 'f', 'g']:
                        k = f'(4{sub})'
                        if k in eq_map:
                            grouped_4.append(eq_map[k])
                    
                    if grouped_4:
                        # Clean LaTeX math block
                        math_lines = []
                        for eq in grouped_4:
                            # Align at arrow: replace → with &\rightarrow
                            eq_clean = eq.replace('→', '&\\rightarrow ')
                            eq_clean = eq_clean.replace('•', '^\\bullet ')
                            math_lines.append(eq_clean)
                        clean_block = "\n\n$$\n\\begin{aligned}\n" + " \\\\\n".join(math_lines) + "\n\\end{aligned}\n$$\n\n"
                        
                        # Safe replacement: find the paragraphs between (4a) and (4g)
                        blocks = text.split('\n\n')
                        start_idx = -1
                        end_idx = -1
                        for i, block in enumerate(blocks):
                            if '(4a)' in block:
                                start_idx = i
                            if '(4' in block and 'g)' in block.replace(' ', ''):
                                end_idx = i
                                
                        if start_idx != -1 and end_idx != -1 and start_idx <= end_idx:
                            blocks[start_idx:end_idx+1] = [clean_block]
                            text = '\n\n'.join(blocks)
                        else:
                            # Fallback replacement for individual equations
                            for k, v in eq_map.items():
                                text = re.sub(rf'[^\n]*\+[^\n]*→[^\n]*{re.escape(k)}', lambda m, val=v: f"\n\n$$ {val} $$\n\n", text)
                except Exception as e:
                    print(f"Warning in equation spatial repair: {e}")
                return text

            stitched_md = sanitize_latex(stitched_md)
            stitched_md = fix_scrambled_equations(stitched_md, input_path)
            
            with open(output_path, "w", encoding="utf-8") as f:
                f.write(stitched_md)
        except Exception as norm_err:
            print(f"Warning normalizing image paths: {norm_err}")
            
        print(f"Success converting {input_path} -> {output_path}")
        sys.exit(0)
    except Exception as e:
        print(f"Error during conversion: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
