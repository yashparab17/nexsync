    use super::*;

    fn deck() -> (String, String, Vec<String>) {
        let o = blank().unwrap();
        let id = register(&o.parts.base).unwrap();
        (o.parts.base, id, o.parts.slides)
    }

    #[test]
    fn slides_get_notes_transitions_and_backgrounds_and_shapes_get_outlines_and_alignment() {
        let (_, id, slides) = deck();
        let s = edit_slide(&slides[0], &SlideEdit { notes: Some("Say hello
Then the numbers".into()), transition: Some("fade".into()), hidden: Some(true), background: Some("102030".into()), ..Default::default() }).unwrap();
        let slide: Slide = serde_json::from_str(&s).unwrap();
        assert_eq!(slide.notes.text(), "Say hello
Then the numbers");
        assert_eq!(slide.transition.as_ref().map(|t| t.kind.as_str()), Some("fade"));
        assert!(slide.hidden && slide.background.is_some());
        let plain: Slide = serde_json::from_str(&edit_slide(&s, &SlideEdit { transition: Some("none".into()), background: Some(String::new()), ..Default::default() }).unwrap()).unwrap();
        assert!(plain.transition.is_none() && plain.background.is_none());
        assert!(edit_slide(&slides[0], &SlideEdit { transition: Some("evil".into()), ..Default::default() }).is_err());
        // The background shows in the picture
        assert_ne!(render(&id, &slides[0], 0.2).unwrap().png, render(&id, &s, 0.2).unwrap().png);
        let tb = new_shape("textBox", 90, 10.0, 10.0, 200.0, 60.0).unwrap();
        let edited = edit_shape(&tb, &ShapeEdit { align: Some("center".into()), underline: Some(true), font: Some("Arial".into()), line: Some("FF0000".into()), line_width: Some(3.0), ..Default::default() }).unwrap();
        let shape: Shape = serde_json::from_str(&edited).unwrap();
        assert!(shape.line.as_ref().is_some_and(|l| l.width == Some(3.0)));
        let para = &shape.text.as_ref().unwrap().paragraphs[0];
        assert_eq!(para.props.align, Some(deckcraft_model::text::Align::Center));
        assert_eq!(para.runs[0].props.font.as_deref(), Some("Arial"));
        assert!(edit_shape(&tb, &ShapeEdit { align: Some("sideways".into()), ..Default::default() }).is_err());
    }

    #[test]
    fn a_picture_goes_into_the_deck_and_out_in_the_file() {
        // A 1x1 PNG
        let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        let o = blank().unwrap();
        let (base, shape) = add_picture(&o.parts.base, "my pic.png", png, 50, 100.0, 100.0, 200.0, 120.0).unwrap();
        let mut slide: Slide = serde_json::from_str(&o.parts.slides[0]).unwrap();
        slide.shapes.push(serde_json::from_str(&shape).unwrap());
        let bytes = export(&base, &[serde_json::to_string(&slide).unwrap()]).unwrap();
        let back = open("a.pptx", &bytes).unwrap();
        let again = assemble(&back.parts.base, &back.parts.slides).unwrap();
        assert!(again.media.iter().any(|m| m.content_type == "image/png" && !m.data.is_empty()));
        assert!(again.slides[0].shapes.iter().any(|s| matches!(s.kind, ShapeKind::Picture { .. })));
        assert!(add_picture(&o.parts.base, "x.png", "AAAA", 51, 0.0, 0.0, 10.0, 10.0).is_err());
    }

    #[test]
    fn a_picture_on_a_slide_is_drawn_and_has_a_frame() {
        let png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        let o = blank().unwrap();
        let (base, shape) = add_picture(&o.parts.base, "p.png", png, 50, 100.0, 100.0, 400.0, 300.0).unwrap();
        let mut slide: Slide = serde_json::from_str(&o.parts.slides[0]).unwrap();
        slide.shapes.push(serde_json::from_str(&shape).unwrap());
        let with = serde_json::to_string(&slide).unwrap();
        let id = register(&base).unwrap();
        let plain = render(&id, &o.parts.slides[0], 0.5).unwrap();
        let drawn = render(&id, &with, 0.5).unwrap();
        assert_ne!(plain.png, drawn.png, "the picture was not drawn");
        assert!(drawn.frames.iter().any(|f| f.kind == "picture" && f.w > 300.0), "{:?}", drawn.frames);
    }

    #[test]
    fn media_bytes_survive_the_pieces() {
        let mut p = defaults::blank_presentation(deckcraft_geom::Size::new(960.0, 540.0), deckcraft_model::theme::Theme::default(), true);
        p.add_media("a.png", "image/png", vec![1, 2, 3, 4, 5]).unwrap();
        let parts = split(&p).unwrap();
        let back = assemble(&parts.base, &parts.slides).unwrap();
        assert_eq!(back.media.len(), 1);
        assert_eq!(back.media[0].data.len(), 5, "picture bytes were lost in the base");
    }

    #[test]
    fn a_new_deck_has_a_title_slide_that_draws_with_boxes_for_its_shapes() {
        let (_, id, slides) = deck();
        assert_eq!(slides.len(), 1);
        let r = render(&id, &slides[0], 1.0).unwrap();
        let png = BASE64_STANDARD.decode(&r.png).unwrap();
        assert!(png.starts_with(b"\x89PNG") && png.len() > 1000);
        assert_eq!((r.width_pt, r.height_pt), (960.0, 540.0));
        // The title and the subtitle inherit their place from the layout; the boxes say where
        assert_eq!(r.frames.len(), 2);
        assert!(r.frames.iter().all(|f| f.placeholder && f.w > 100.0 && f.h > 20.0));
        assert_eq!(render("nope", &slides[0], 1.0).unwrap_err(), "unknown base");
        assert!(render(&id, &slides[0], 0.0).is_err());
    }

    #[test]
    fn text_shapes_and_fills_are_added_and_changed_and_the_slide_draws_differently() {
        let (base, id, mut slides) = deck();
        let before = render(&id, &slides[0], 1.0).unwrap().png;
        let mut slide: Slide = serde_json::from_str(&slides[0]).unwrap();
        let tb = new_shape("textBox", 900, 100.0, 100.0, 400.0, 80.0).unwrap();
        let tb = edit_shape(&tb, &ShapeEdit { text: Some("Hello\ndeck".into()), bold: Some(true), size: Some(40.0), color: Some("C00000".into()), ..Default::default() }).unwrap();
        assert_eq!(text_of(&tb).unwrap(), "Hello\ndeck");
        let rect = edit_shape(&new_shape("ellipse", 901, 50.0, 300.0, 200.0, 120.0).unwrap(), &ShapeEdit { fill: Some("2D64D2".into()), ..Default::default() }).unwrap();
        slide.shapes.push(serde_json::from_str(&tb).unwrap());
        slide.shapes.push(serde_json::from_str(&rect).unwrap());
        slides[0] = serde_json::to_string(&slide).unwrap();
        let after = render(&id, &slides[0], 1.0).unwrap();
        assert_ne!(before, after.png);
        assert!(after.frames.iter().any(|f| f.id == 900 && f.x == 100.0 && f.w == 400.0 && !f.placeholder));
        // The same edits survive a trip through a .pptx file
        let bytes = export(&base, &slides).unwrap();
        let back = open("deck.pptx", &bytes).unwrap();
        assert_eq!(back.parts.slides.len(), 1);
        let again: Slide = serde_json::from_str(&back.parts.slides[0]).unwrap();
        assert!(again.shapes.iter().any(|s| s.text.as_ref().is_some_and(|t| t.text() == "Hello\ndeck")));
        assert!(new_shape("blob", 1, 0.0, 0.0, 10.0, 10.0).is_err());
        assert!(edit_shape(&tb, &ShapeEdit { fill: Some("nonsense".into()), ..Default::default() }).is_err());
    }

    #[test]
    fn a_new_slide_follows_a_layout_and_two_slides_with_one_id_get_their_own() {
        let (base, id, slides) = deck();
        let all = layouts(&id).unwrap();
        assert!(all.len() > 5 && all.iter().any(|l| l.name.to_lowercase().contains("title")));
        let content = all.iter().find(|l| l.name.to_lowercase().contains("content")).unwrap();
        let fresh = new_slide(&id, content.id).unwrap();
        let s: Slide = serde_json::from_str(&fresh).unwrap();
        assert!(s.shapes.len() >= 2 && s.shapes.iter().all(|x| x.ph.is_some()));
        assert!(new_slide(&id, 999_999).is_err());
        // Two people added a slide at once: both have the same id
        let p = assemble(&base, &[slides[0].clone(), fresh.clone(), fresh]).unwrap();
        let mut ids: Vec<u32> = p.slides.iter().map(|s| s.id.0).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), 3);
    }

    #[test]
    fn a_text_edit_keeps_the_look_of_the_first_run_and_moving_a_placeholder_gives_it_a_place() {
        let (_, id, slides) = deck();
        let slide: Slide = serde_json::from_str(&slides[0]).unwrap();
        let title = serde_json::to_string(&slide.shapes[0]).unwrap();
        let typed = edit_shape(&title, &ShapeEdit { text: Some("Quarterly review".into()), ..Default::default() }).unwrap();
        let moved = edit_shape(&typed, &ShapeEdit { x: Some(40.0), y: Some(30.0), w: Some(500.0), h: Some(90.0), ..Default::default() }).unwrap();
        let s: Shape = serde_json::from_str(&moved).unwrap();
        assert_eq!((s.xfrm.unwrap().x, s.xfrm.unwrap().w), (40.0, 500.0));
        assert!(s.ph.is_some());
        let mut slide = slide;
        slide.shapes[0] = s;
        let r = render(&id, &serde_json::to_string(&slide).unwrap(), 1.0).unwrap();
        assert!(r.frames.iter().any(|f| f.x == 40.0 && f.y == 30.0));
    }

    #[test]
    fn junk_encrypted_and_oversized_input_are_refused() {
        assert!(open("a.pptx", b"not a zip").is_err());
        assert!(open("a.docx", b"PK\x03\x04").unwrap_err().contains("opens .pptx"));
        assert!(assemble("{", &[]).is_err());
        // A deck from another device that claims a huge slide is not drawn
        let mut base: serde_json::Value = serde_json::from_str(&blank().unwrap().parts.base).unwrap();
        base["slideSize"] = serde_json::json!({"width": 1.0e7, "height": 1.0e7});
        assert!(register(&base.to_string()).unwrap_err().contains("not a size"));
        // A big but allowed size is not drawn at a size that would fill the memory
        base["slideSize"] = serde_json::json!({"width": 20000.0, "height": 20000.0});
        let id = register(&base.to_string()).unwrap();
        assert!(render(&id, "{}", 1.0).unwrap_err().contains("too large"));
        assert!(assemble(&blank().unwrap().parts.base, &["{".to_string()]).is_err());
    }

    #[test]
    fn looks_apply_to_a_range_and_typing_keeps_them() {
        let tb = new_shape("textBox", 90, 10.0, 10.0, 200.0, 60.0).unwrap();
        let tb = edit_shape(&tb, &ShapeEdit { text: Some("Hello big world".into()), ..Default::default() }).unwrap();
        let tb = edit_shape(&tb, &ShapeEdit { bold: Some(true), range: Some([6, 9]), ..Default::default() }).unwrap();
        let shape: Shape = serde_json::from_str(&tb).unwrap();
        let runs = &shape.text.as_ref().unwrap().paragraphs[0].runs;
        assert_eq!(runs.iter().map(|r| (r.text.as_str(), r.props.bold)).collect::<Vec<_>>(), vec![("Hello ", None), ("big", Some(true)), (" world", None)]);
        // Typing inside the bold word keeps it bold, and the rest is as it was
        let typed = edit_shape(&tb, &ShapeEdit { text: Some("Hello bigger world".into()), ..Default::default() }).unwrap();
        let shape: Shape = serde_json::from_str(&typed).unwrap();
        let runs = &shape.text.as_ref().unwrap().paragraphs[0].runs;
        assert_eq!(runs.iter().map(|r| (r.text.as_str(), r.props.bold)).collect::<Vec<_>>(), vec![("Hello ", None), ("bigger", Some(true)), (" world", None)]);
        // Paragraphs: a new one takes the settings of the one it was typed in
        let two = edit_shape(&typed, &ShapeEdit { text: Some("Hello bigger world\nmore".into()), bullet: Some("num".into()), line_spacing: Some(1.5), space_after: Some(6.0), ..Default::default() }).unwrap();
        let shape: Shape = serde_json::from_str(&two).unwrap();
        let ps = &shape.text.as_ref().unwrap().paragraphs;
        assert_eq!(ps.len(), 2);
        assert!(ps.iter().all(|p| matches!(p.props.bullet, Some(deckcraft_model::text::Bullet::AutoNum { .. })) && p.props.line_spacing.is_some()));
        // A range touching only the second paragraph leaves the first one's bullet alone
        let off = edit_shape(&two, &ShapeEdit { bullet: Some("none".into()), range: Some([20, 20]), ..Default::default() }).unwrap();
        let shape: Shape = serde_json::from_str(&off).unwrap();
        let ps = &shape.text.as_ref().unwrap().paragraphs;
        assert!(matches!(ps[0].props.bullet, Some(deckcraft_model::text::Bullet::AutoNum { .. })) && matches!(ps[1].props.bullet, Some(deckcraft_model::text::Bullet::None)));
        assert!(edit_shape(&tb, &ShapeEdit { bullet: Some("star".into()), ..Default::default() }).is_err());
    }

    #[test]
    fn tables_groups_layouts_find_and_timing() {
        let (_, id, slides) = deck();
        // A table: grows, takes text, draws
        let t = new_table(80, 2, 2, 50.0, 200.0, 400.0, 100.0).unwrap();
        let t = edit_table(&t, &TableEdit { insert_row: Some(2), cells: Some(vec![vec!["a".into(), "b".into()], vec!["c".into(), "d".into()], vec!["e".into(), "f".into()]]), ..Default::default() }).unwrap();
        let shape: Shape = serde_json::from_str(&t).unwrap();
        let ShapeKind::Table(table) = &shape.kind else { panic!("not a table") };
        assert_eq!((table.n_rows(), table.cell(2, 1).unwrap().text.text()), (3, "f".to_string()));
        assert!(edit_table(&t, &TableEdit { delete_row: Some(0), ..Default::default() }).is_ok());
        assert!(new_table(80, 0, 2, 0.0, 0.0, 10.0, 10.0).is_err());
        let mut slide: Slide = serde_json::from_str(&slides[0]).unwrap();
        slide.shapes.push(shape);
        let drawn = render(&id, &serde_json::to_string(&slide).unwrap(), 0.5).unwrap();
        assert!(drawn.frames.iter().any(|f| f.id == 80 && f.kind == "table"));
        // Find and replace in the table's cells, case aside, one then all
        let (_, n) = replace_text(&t, "A", "x", false, false).unwrap();
        assert_eq!(n, 1);
        let (_, n) = replace_text(&t, "A", "x", true, false).unwrap();
        assert_eq!(n, 0);
        let tb = edit_shape(&new_shape("textBox", 81, 10.0, 10.0, 200.0, 60.0).unwrap(), &ShapeEdit { text: Some("one two one".into()), ..Default::default() }).unwrap();
        assert_eq!(replace_text(&tb, "one", "1", true, true).unwrap().1, 1);
        let (done, n) = replace_text(&tb, "one", "1", true, false).unwrap();
        assert_eq!((n, text_of(&done).unwrap()), (2, "1 two 1".to_string()));
        // Group and ungroup give the shapes back where they were
        let a = new_shape("rect", 82, 10.0, 10.0, 100.0, 50.0).unwrap();
        let b = new_shape("ellipse", 83, 200.0, 100.0, 100.0, 50.0).unwrap();
        let g = group(&[a, b], 84).unwrap();
        let gs: Shape = serde_json::from_str(&g).unwrap();
        assert_eq!((gs.xfrm.unwrap().x, gs.xfrm.unwrap().w), (10.0, 290.0));
        let back = ungroup(&g).unwrap();
        let first: Shape = serde_json::from_str(&back[0]).unwrap();
        assert_eq!((back.len(), first.xfrm.unwrap().x, first.xfrm.unwrap().w), (2, 10.0, 100.0));
        assert!(group(std::slice::from_ref(&tb), 85).is_err() && ungroup(&tb).is_err());
        // A title slide moved to a layout with content gets its placeholders
        let content = layouts(&id).unwrap().into_iter().find(|l| l.name.to_lowercase().contains("content")).unwrap();
        let moved: Slide = serde_json::from_str(&apply_layout(&id, &slides[0], content.id, 500).unwrap()).unwrap();
        assert_eq!(moved.layout.0, content.id);
        assert!(moved.shapes.len() >= 2 && moved.shapes.iter().map(|s| s.id.0).collect::<std::collections::HashSet<_>>().len() == moved.shapes.len());
        assert!(apply_layout(&id, &slides[0], 999_999, 500).is_err());
        // Timing: after 5 seconds, not on a click; clearing it all leaves no transition
        let timed = edit_slide(&slides[0], &SlideEdit { advance_after: Some(5.0), advance_on_click: Some(false), ..Default::default() }).unwrap();
        let s: Slide = serde_json::from_str(&timed).unwrap();
        let tr = s.transition.unwrap();
        assert_eq!((tr.advance_after_ms, tr.advance_on_click, tr.kind.as_str()), (Some(5000), false, "none"));
        let cleared = edit_slide(&timed, &SlideEdit { advance_after: Some(0.0), advance_on_click: Some(true), ..Default::default() }).unwrap();
        assert!(serde_json::from_str::<Slide>(&cleared).unwrap().transition.is_none());
    }
